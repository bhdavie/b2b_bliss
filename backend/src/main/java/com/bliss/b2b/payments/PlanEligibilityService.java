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
        long discountedTotal = rules.applyDiscountCents(totalAmountCents);

        if (weeks < rules.minLeadTimeWeeks()) {
            return ineligible("too_close", days, 0L, totalAmountCents, discountedTotal);
        }
        if (rules.maxLeadTimeWeeks() != null && weeks > rules.maxLeadTimeWeeks()) {
            return ineligible("too_far", days, 0L, totalAmountCents, discountedTotal);
        }
        // Amount limits apply to the booking's published price (pre-discount),
        // not the post-discount or post-deposit balance. A merchant who only
        // offers plans on $1k+ bookings is gating on the actual ticket size.
        if (rules.minBookingAmountCents() != null && totalAmountCents < rules.minBookingAmountCents()) {
            return ineligible("amount_too_low", days, 0L, totalAmountCents, discountedTotal);
        }
        if (rules.maxBookingAmountCents() != null && totalAmountCents > rules.maxBookingAmountCents()) {
            return ineligible("amount_too_high", days, 0L, totalAmountCents, discountedTotal);
        }

        // Deposit and installments are computed off the post-discount total so
        // the customer's combined payments equal what they were quoted on the
        // checkout page.
        long deposit = rules.computeDepositCents(discountedTotal);
        if (deposit >= discountedTotal && deposit > 0) {
            // A fixed deposit that swallows the entire booking total — most
            // commonly a $50 fixed deposit on a $40 service when the merchant
            // didn't set a max cap. Reject so the merchant fixes their config
            // rather than the customer paying in full through what was
            // supposed to be a plan flow.
            return ineligible("deposit_too_high", days, deposit, totalAmountCents, discountedTotal);
        }
        long installmentTotal = discountedTotal - deposit;

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
            return ineligible(reason, days, deposit, totalAmountCents, discountedTotal);
        }
        return new EligibilityResult(true, "ok", days, deposit,
                totalAmountCents, discountedTotal, List.copyOf(options));
    }

    private static EligibilityResult ineligible(
            String reason, long days, long deposit,
            long originalTotal, long discountedTotal
    ) {
        return new EligibilityResult(false, reason, days, deposit,
                originalTotal, discountedTotal, List.of());
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

        List<LocalDate> dueDates;
        if (frequency == PlanFrequency.MONTHLY && hasDeposit) {
            // Anchor monthly installments to the 1st of each calendar month so
            // they line up with typical pay cycles. Skip the first 1st if it
            // lands within 7 days of the deposit charge to avoid stacking two
            // charges in the same week.
            dueDates = monthlyFirstOfMonthDueDates(today, appointmentDate.minusDays(effectiveBuffer));
        } else {
            long intervals = usableDays / frequency.days();
            // Without a deposit the first installment fires today, so the count
            // is 1 + intervals (matches Phase 0-4 math). With a deposit the
            // first installment is pushed to day F, so the count drops to
            // intervals (no day-0 installment).
            int n = hasDeposit ? (int) intervals : (int) (1 + intervals);
            if (n < 1) return null;
            // A plan with zero deposit and just one installment is really a
            // single charge — keep the legacy >= 2 floor for that case. With a
            // deposit, 1 installment is fine because the deposit counts as the
            // first commitment event.
            if (!hasDeposit && n < 2) return null;
            dueDates = new ArrayList<>(n);
            int startMultiplier = hasDeposit ? 1 : 0;
            for (int i = 0; i < n; i++) {
                dueDates.add(today.plusDays((long) (startMultiplier + i) * frequency.days()));
            }
        }

        int numPayments = dueDates.size();
        if (numPayments < 1) return null;
        if (installmentTotalCents <= 0) return null;

        long perPayment = installmentTotalCents / numPayments;
        long remainder = installmentTotalCents - perPayment * numPayments;
        long finalPayment = perPayment + remainder;

        return new PlanOption(frequency, numPayments, perPayment, finalPayment, List.copyOf(dueDates));
    }

    private static List<LocalDate> monthlyFirstOfMonthDueDates(LocalDate today, LocalDate cutoff) {
        LocalDate earliest = today.plusDays(7);
        LocalDate cursor = earliest.getDayOfMonth() == 1
                ? earliest
                : earliest.withDayOfMonth(1).plusMonths(1);
        List<LocalDate> dates = new ArrayList<>();
        while (!cursor.isAfter(cutoff)) {
            dates.add(cursor);
            cursor = cursor.plusMonths(1);
        }
        return dates;
    }
}
