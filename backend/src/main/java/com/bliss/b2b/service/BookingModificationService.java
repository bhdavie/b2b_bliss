package com.bliss.b2b.service;

import com.bliss.b2b.domain.Booking;
import com.bliss.b2b.domain.PaymentPlan;
import com.bliss.b2b.domain.PaymentPlanStatus;
import com.bliss.b2b.domain.PaymentScheduleEntry;
import com.bliss.b2b.domain.PaymentScheduleStatus;
import com.bliss.b2b.domain.ScheduleKind;
import com.bliss.b2b.payments.MerchantPlanRules;
import com.bliss.b2b.payments.PlanEligibilityService;
import com.bliss.b2b.payments.PlanFrequency;
import com.bliss.b2b.payments.PlanOption;
import com.bliss.b2b.persistence.BookingDao;
import com.bliss.b2b.persistence.MerchantPlanRulesDao;
import com.bliss.b2b.persistence.PaymentPlanDao;
import com.bliss.b2b.persistence.PaymentScheduleDao;
import com.bliss.b2b.persistence.PlanModificationDao;
import java.time.Clock;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.jdbi.v3.core.Handle;
import org.jdbi.v3.core.Jdbi;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Booking modification + plan recalculation. Rail-agnostic by construction: it
 * operates purely on the booking row and the {@code payment_schedule} rows and
 * never touches card capture, adapters, or the charge execution paths.
 *
 * <p>Recalc rules (locked design):
 * <ul>
 *   <li>{@code paid} and {@code processing} rows are immutable — never touched.
 *   <li>{@code collected} = sum of paid + processing amounts.
 *   <li>The schedule sums to price + Bliss fee (as at creation); the fee is
 *       preserved, not re-derived. {@code remainingToCollect = (newPrice + fee)
 *       − collected}.
 *   <li>Rebuild only the {@code scheduled}/{@code retrying} rows: delete them and
 *       regenerate installments for {@code remainingToCollect} from today through
 *       the merchant's payment deadline against the NEW dates, on the plan's
 *       existing frequency.
 *   <li>{@code remainingToCollect <= 0}: cancel the remaining scheduled rows and
 *       move the plan to {@link PaymentPlanStatus#REFUND_DUE} for the merchant to
 *       handle manually. No auto-refund.
 *   <li>New dates that leave no room for even one installment before the deadline
 *       are rejected wholesale (no partial apply).
 * </ul>
 *
 * <p>The booking row and the plan rebuild are written in one transaction, so a
 * booking change can never silently diverge from its plan.
 */
public class BookingModificationService {

    private static final Logger log = LoggerFactory.getLogger(BookingModificationService.class);

    private final Jdbi jdbi;
    private final PlanEligibilityService eligibilityService;
    private final Clock clock;

    public BookingModificationService(Jdbi jdbi, PlanEligibilityService eligibilityService, Clock clock) {
        this.jdbi = jdbi;
        this.eligibilityService = eligibilityService;
        this.clock = clock;
    }

    /**
     * Computes (and, unless {@code preview}, applies) a booking modification. The
     * whole thing runs in one transaction; on preview nothing is written, so the
     * returned schedule is exactly what a subsequent apply would produce.
     */
    public ModificationResult modify(ModifyInput input) {
        return jdbi.inTransaction(handle -> run(handle, input));
    }

    private ModificationResult run(Handle handle, ModifyInput input) {
        Booking booking = handle.attach(BookingDao.class)
                .findByIdForMerchant(input.bookingId(), input.merchantId())
                .orElseThrow(() -> new ModificationException(Code.NOT_FOUND, "booking not found"));
        PaymentPlan plan = handle.attach(PaymentPlanDao.class)
                .findActiveForBooking(booking.id())
                .orElseThrow(() -> new ModificationException(
                        Code.NO_ACTIVE_PLAN, "this booking has no active plan to modify"));
        if (plan.status() != PaymentPlanStatus.ACTIVE) {
            throw new ModificationException(Code.PLAN_NOT_ACTIVE,
                    "only an active plan can be modified (plan is " + plan.status().wire() + ")");
        }

        LocalDate today = LocalDate.now(clock);
        List<PaymentScheduleEntry> schedule = handle.attach(PaymentScheduleDao.class).listForPlan(plan.id());

        // --- validate the requested changes -------------------------------
        if (input.newAppointmentDate() == null
                && input.newCheckoutDate() == null
                && input.newTotalAmountCents() == null) {
            throw new ModificationException(Code.INVALID_INPUT,
                    "provide at least one of: appointmentDate, checkoutDate, newTotalAmountCents");
        }
        LocalDate appointment = input.newAppointmentDate() != null
                ? input.newAppointmentDate() : booking.appointmentDate();
        LocalDate checkout = input.newCheckoutDate() != null
                ? input.newCheckoutDate() : booking.checkoutDate();
        long price = input.newTotalAmountCents() != null
                ? input.newTotalAmountCents() : booking.totalAmountCents();

        if (!appointment.isAfter(today)) {
            throw new ModificationException(Code.INVALID_INPUT, "appointment date must be in the future");
        }
        if (checkout != null && checkout.isBefore(appointment)) {
            throw new ModificationException(Code.INVALID_INPUT,
                    "checkout date must be on or after the appointment date");
        }
        if (price <= 0) {
            throw new ModificationException(Code.INVALID_INPUT, "total must be positive");
        }

        // --- recalc math (rail-agnostic) ----------------------------------
        long collected = schedule.stream()
                .filter(e -> isCollected(e.status()))
                .mapToLong(PaymentScheduleEntry::amountCents)
                .sum();
        long fee = plan.processingFeeCents();
        long targetScheduleSum = price + fee; // preserve the fee model from creation
        long remaining = targetScheduleSum - collected;

        // Rows we keep as-is (everything except the rebuildable scheduled/retrying).
        List<PaymentScheduleEntry> preserved = schedule.stream()
                .filter(e -> !isRebuildable(e.status()))
                .sorted(java.util.Comparator.comparingInt(PaymentScheduleEntry::sequence))
                .toList();
        int maxPreservedSeq = preserved.stream()
                .mapToInt(PaymentScheduleEntry::sequence).max().orElse(0);

        if (remaining <= 0) {
            return refundDue(handle, input, booking, plan, appointment, checkout, price,
                    collected, remaining, preserved);
        }

        // Rebuild the remaining schedule against the new dates on the plan's cadence.
        MerchantPlanRules rules = handle.attach(MerchantPlanRulesDao.class)
                .findByMerchantId(booking.merchantId())
                .orElse(MerchantPlanRules.DEFAULTS);
        PlanOption option = eligibilityService.installmentPlanFor(
                today, appointment, remaining, plan.frequency(), rules.paymentDueOffsetDays(), true);
        if (option == null) {
            throw new ModificationException(Code.DEADLINE_IMPOSSIBLE, deadlineMessage(
                    today, appointment, plan.frequency(), rules.paymentDueOffsetDays(), remaining));
        }

        // New installment rows, sequences continuing after the preserved ones.
        List<ScheduleRow> newRows = new ArrayList<>();
        int seq = maxPreservedSeq;
        for (int i = 0; i < option.dueDates().size(); i++) {
            boolean last = i == option.dueDates().size() - 1;
            long amount = last ? option.finalPaymentAmountCents() : option.perPaymentAmountCents();
            seq++;
            newRows.add(new ScheduleRow(seq, option.dueDates().get(i), amount,
                    PaymentScheduleStatus.SCHEDULED.wire(), ScheduleKind.INSTALLMENT.wire()));
        }
        int numPayments = preserved.size() + newRows.size();
        LocalDate endDate = newRows.get(newRows.size() - 1).dueDate();

        if (!input.preview()) {
            PlanModificationDao modDao = handle.attach(PlanModificationDao.class);
            modDao.deleteRebuildable(plan.id());
            PaymentScheduleDao scheduleDao = handle.attach(PaymentScheduleDao.class);
            for (ScheduleRow r : newRows) {
                scheduleDao.insert(plan.id(), r.sequence(), r.dueDate(), r.amountCents(), r.status(), r.kind());
            }
            modDao.updatePlanAfterModify(plan.id(), price, numPayments, endDate);
            modDao.updateBookingDetails(booking.id(), appointment, checkout, price);
            // NOTIFICATION HOOK (out of scope): a guest "your plan was updated"
            // email/SMS would fire here, once delivery is wired.
            log.info("Booking {} modified: plan {} rebuilt to {} installments (remaining {}c)",
                    booking.id(), plan.id(), newRows.size(), remaining);
        }

        List<ScheduleRow> resulting = new ArrayList<>();
        preserved.forEach(e -> resulting.add(ScheduleRow.of(e)));
        resulting.addAll(newRows);
        return new ModificationResult(
                Outcome.REBUILT, input.preview(),
                appointment, checkout, price,
                PaymentPlanStatus.ACTIVE.wire(), price, numPayments,
                collected, remaining, 0L, resulting,
                input.preview()
                        ? "Preview: " + newRows.size() + " installments would be rebuilt."
                        : newRows.size() + " installments rebuilt.");
    }

    private ModificationResult refundDue(
            Handle handle, ModifyInput input, Booking booking, PaymentPlan plan,
            LocalDate appointment, LocalDate checkout, long price,
            long collected, long remaining, List<PaymentScheduleEntry> preserved) {
        long overpaid = -remaining; // collected beyond the new total
        int numPayments = Math.max(1, preserved.size());
        LocalDate endDate = preserved.isEmpty()
                ? appointment
                : preserved.get(preserved.size() - 1).dueDate();

        if (!input.preview()) {
            PlanModificationDao modDao = handle.attach(PlanModificationDao.class);
            modDao.cancelRebuildable(plan.id());
            modDao.updatePlanAfterModify(plan.id(), price, numPayments, endDate);
            modDao.updateBookingDetails(booking.id(), appointment, checkout, price);
            handle.attach(PaymentPlanDao.class).updateStatus(plan.id(), PaymentPlanStatus.REFUND_DUE.wire());
            // NOTIFICATION HOOK (out of scope): a guest "booking reduced, refund
            // pending" email would fire here, once delivery is wired.
            log.info("Booking {} modified below collected: plan {} -> refund_due (overpaid {}c)",
                    booking.id(), plan.id(), overpaid);
        }

        List<ScheduleRow> resulting = new ArrayList<>();
        preserved.forEach(e -> resulting.add(ScheduleRow.of(e)));
        return new ModificationResult(
                Outcome.REFUND_DUE, input.preview(),
                appointment, checkout, price,
                PaymentPlanStatus.REFUND_DUE.wire(), price, numPayments,
                collected, remaining, overpaid, resulting,
                "New total is below the "
                        + dollars(collected) + " already collected; "
                        + dollars(overpaid) + " is refund-due. Remaining charges canceled; "
                        + "handle the refund manually.");
    }

    private static boolean isCollected(PaymentScheduleStatus s) {
        return s == PaymentScheduleStatus.PAID || s == PaymentScheduleStatus.PROCESSING;
    }

    private static boolean isRebuildable(PaymentScheduleStatus s) {
        return s == PaymentScheduleStatus.SCHEDULED || s == PaymentScheduleStatus.RETRYING;
    }

    private static String deadlineMessage(
            LocalDate today, LocalDate appointment, PlanFrequency frequency,
            int dueOffsetDays, long remaining) {
        int buffer = Math.max(PlanEligibilityService.MIN_FINAL_PAYMENT_BUFFER_DAYS, dueOffsetDays);
        LocalDate earliest = today.plusDays((long) frequency.days() + buffer);
        String cadence = frequency == PlanFrequency.BIWEEKLY ? "bi-weekly (14-day)" : "monthly";
        return "The new check-in date " + appointment + " leaves no room to schedule the "
                + dollars(remaining) + " balance before the payment deadline ("
                + buffer + " days before check-in) on this " + cadence + " plan. "
                + "Move check-in to on or after " + earliest + ", or collect the balance outside a plan.";
    }

    private static String dollars(long cents) {
        return "$" + String.format("%,.2f", cents / 100.0);
    }

    // --- types ------------------------------------------------------------

    public enum Outcome { REBUILT, REFUND_DUE }

    public enum Code { NOT_FOUND, NO_ACTIVE_PLAN, PLAN_NOT_ACTIVE, INVALID_INPUT, DEADLINE_IMPOSSIBLE }

    public record ModifyInput(
            UUID bookingId,
            UUID merchantId,
            LocalDate newAppointmentDate,
            LocalDate newCheckoutDate,
            Long newTotalAmountCents,
            boolean preview
    ) {}

    public record ScheduleRow(
            int sequence, LocalDate dueDate, long amountCents, String status, String kind) {
        static ScheduleRow of(PaymentScheduleEntry e) {
            return new ScheduleRow(e.sequence(), e.dueDate(), e.amountCents(),
                    e.status().wire(), e.kind().wire());
        }
    }

    public record ModificationResult(
            Outcome outcome,
            boolean preview,
            LocalDate appointmentDate,
            LocalDate checkoutDate,
            long totalAmountCents,
            String planStatus,
            long planTotalAmountCents,
            int numPayments,
            long collectedCents,
            long remainingToCollectCents,
            long overpaidCents,
            List<ScheduleRow> schedule,
            String message
    ) {}

    public static class ModificationException extends RuntimeException {
        private final Code code;

        public ModificationException(Code code, String message) {
            super(message);
            this.code = code;
        }

        public Code code() {
            return code;
        }
    }
}
