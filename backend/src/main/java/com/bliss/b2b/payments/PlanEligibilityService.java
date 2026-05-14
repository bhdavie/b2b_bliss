package com.bliss.b2b.payments;

import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;

/**
 * Determines which plan frequencies are available for a booking by combining
 * the merchant's configured {@link MerchantPlanRules} with what the time-to-
 * appointment math will actually fit. Pure function — deliberately stateless
 * so it can be mirrored on the frontend for live UX preview, while the
 * backend remains the source of truth on plan creation
 * (see CLAUDE.md "Plan eligibility").
 *
 * <p>When deposits are enabled (Phase 9), the deposit fires on day 0 (today)
 * and the installments cover {@code total - deposit} on the chosen cadence,
 * starting at day {@code F} (one cadence interval after today) so they don't
 * collide with the deposit charge. The final installment lands at least
 * {@link #MIN_FINAL_PAYMENT_BUFFER_DAYS} before the appointment so any retry
 * clears before the booking date.
 *
 * <p>Without a deposit, the original Phase 0-4 behavior holds: the first
 * payment fires on day 0 and the schedule still needs at least 2 payments
 * to be a "plan".
 */
public class PlanEligibilityService {

    public static final int MIN_FINAL_PAYMENT_BUFFER_DAYS = 3;

    public EligibilityResult evaluate(
            LocalDate today,
            LocalDate appointmentDate,
            long totalAmountCents,
            MerchantPlanRules rules
    ) {
        long days = ChronoUnit.DAYS.between(today, appointmentDate);
        long weeks = days / 7;

        if (weeks < rules.minLeadTimeWeeks()) {
            return ineligible("too_close", days, 0L);
        }
        if (rules.maxLeadTimeWeeks() != null && weeks > rules.maxLeadTimeWeeks()) {
            return ineligible("too_far", days, 0L);
        }
        // Amount limits apply to the full booking total, not the post-deposit
        // balance. A merchant who only offers plans on $1k+ bookings doesn't
        // suddenly accept a $200 booking because a $100 deposit shrinks the
        // installment principal.
        if (rules.minBookingAmountCents() != null && totalAmountCents < rules.minBookingAmountCents()) {
            return ineligible("amount_too_low", days, 0L);
        }
        if (rules.maxBookingAmountCents() != null && totalAmountCents > rules.maxBookingAmountCents()) {
            return ineligible("amount_too_high", days, 0L);
        }

        long deposit = rules.computeDepositCents(totalAmountCents);
        if (deposit >= totalAmountCents && deposit > 0) {
            // A fixed deposit that swallows the entire booking total — most
            // commonly a $50 fixed deposit on a $40 service when the merchant
            // didn't set a max cap. Reject so the merchant fixes their config
            // rather than the customer paying in full through what was
            // supposed to be a plan flow.
            return ineligible("deposit_too_high", days, deposit);
        }
        long installmentTotal = totalAmountCents - deposit;

        int dueOffsetDays = rules.paymentDueOffsetDays();

        List<PlanOption> options = new ArrayList<>();
        for (PlanFrequency f : rules.allowedFrequencies().frequencies()) {
            PlanOption option = buildInstallments(
                    today, appointmentDate, installmentTotal, deposit > 0, f, dueOffsetDays);
            if (option != null) options.add(option);
        }
        if (options.isEmpty()) {
            // If the merchant configured a non-default payment due deadline
            // and that's what's blocking, surface a specific reason so the
            // merchant preview pane can suggest widening the deadline.
            String reason = dueOffsetDays > MIN_FINAL_PAYMENT_BUFFER_DAYS
                    ? "exceeds_payment_deadline"
                    : "no_plan_fits";
            return ineligible(reason, days, deposit);
        }
        return new EligibilityResult(true, "ok", days, deposit, List.copyOf(options));
    }

    private static EligibilityResult ineligible(String reason, long days, long deposit) {
        return new EligibilityResult(false, reason, days, deposit, List.of());
    }

    private PlanOption buildInstallments(
            LocalDate today,
            LocalDate appointmentDate,
            long installmentTotalCents,
            boolean hasDeposit,
            PlanFrequency frequency,
            int paymentDueOffsetDays
    ) {
        long daysToAppt = ChronoUnit.DAYS.between(today, appointmentDate);
        // The merchant's "all payments due by X days before appointment" rule
        // is a tighter version of the system 3-day retry buffer. Whichever is
        // larger wins.
        long effectiveBuffer = Math.max(MIN_FINAL_PAYMENT_BUFFER_DAYS, paymentDueOffsetDays);
        long usableDays = daysToAppt - effectiveBuffer;
        if (usableDays < 0) return null;
        long intervals = usableDays / frequency.days();
        // Without a deposit the first installment fires today, so the count
        // is 1 + intervals (matches Phase 0-4 math). With a deposit the
        // first installment is pushed to day F, so the count drops to
        // intervals (no day-0 installment).
        int numPayments = hasDeposit ? (int) intervals : (int) (1 + intervals);
        if (numPayments < 1) return null;
        // A plan with zero deposit and just one installment is really a
        // single charge — keep the legacy >= 2 floor for that case. With a
        // deposit, 1 installment is fine because the deposit counts as the
        // first commitment event.
        if (!hasDeposit && numPayments < 2) return null;
        if (installmentTotalCents <= 0) return null;

        long perPayment = installmentTotalCents / numPayments;
        long remainder = installmentTotalCents - perPayment * numPayments;
        long finalPayment = perPayment + remainder;

        List<LocalDate> dueDates = new ArrayList<>(numPayments);
        int startMultiplier = hasDeposit ? 1 : 0;
        for (int i = 0; i < numPayments; i++) {
            dueDates.add(today.plusDays((long) (startMultiplier + i) * frequency.days()));
        }
        return new PlanOption(frequency, numPayments, perPayment, finalPayment, List.copyOf(dueDates));
    }
}
