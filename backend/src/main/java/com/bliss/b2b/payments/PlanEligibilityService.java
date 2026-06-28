package com.bliss.b2b.payments;

import java.time.DayOfWeek;
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

    // Monthly only: payment 2 (the first installment) must be at least this many
    // days after the booking date. The first anchor occurrence that falls inside
    // this window is skipped to the next month so it isn't a too-soon second
    // charge against the immediate payment 1.
    private static final int MONTHLY_FIRST_INSTALLMENT_MIN_GAP_DAYS = 14;

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
        if (frequency == PlanFrequency.MONTHLY) {
            // Monthly: payment 1 is the immediate charge on the booking date
            // itself and is deliberately NOT business-day shifted (it fires the
            // day the booking is made, even on a weekend). Payments 2..N collect
            // on a fixed monthly anchor (the 2nd or 16th, chosen by booking
            // date), each resolved through the weekend roll-forward. See
            // monthlyDueDates for the anchor-selection / spacing rule.
            dueDates = monthlyDueDates(today, appointmentDate.minusDays(effectiveBuffer), hasDeposit);
            if (dueDates.isEmpty()) return null;
            // Without a deposit, payment 1 (today) counts toward the schedule, so
            // a real "plan" still needs at least one monthly installment after it.
            if (!hasDeposit && dueDates.size() < 2) return null;
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
            // Weekday-only rule (biweekly): roll every charge — including the
            // immediate payment 1 — off the weekend forward to Monday.
            for (int i = 0; i < dueDates.size(); i++) {
                dueDates.set(i, rollForwardToWeekday(dueDates.get(i)));
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

    /**
     * Rolls a payment date off the weekend. Saturday and Sunday both move
     * FORWARD to the following Monday; weekdays are returned unchanged. Never
     * rolls backward, so an adjusted date is never earlier than computed. Used
     * for every payment in a schedule, including the immediate first charge.
     */
    public static LocalDate rollForwardToWeekday(LocalDate date) {
        DayOfWeek dow = date.getDayOfWeek();
        if (dow == DayOfWeek.SATURDAY) return date.plusDays(2);
        if (dow == DayOfWeek.SUNDAY) return date.plusDays(1);
        return date;
    }

    private static List<LocalDate> monthlyDueDates(LocalDate today, LocalDate cutoff, boolean hasDeposit) {
        // Payment 1 is the immediate charge on the booking date itself — no
        // anchor logic and no weekend shift. Included here only when there is no
        // separate deposit; when a deposit is configured it fires today via the
        // deposit row, so dueDates holds installments only.
        List<LocalDate> dates = new ArrayList<>();
        if (!hasDeposit) {
            dates.add(today);
        }
        // Installments collect on a fixed monthly anchor (the 2nd or the 16th),
        // chosen by the booking day. Payment 2 is the first anchor occurrence at
        // least MONTHLY_FIRST_INSTALLMENT_MIN_GAP_DAYS days after the booking
        // date (so it isn't a too-soon second charge); payments 3..N advance one
        // month at a time on the same anchor. Each anchor date is resolved
        // through the weekend roll-forward. No extra buffer math — the buffer is
        // baked into the anchor days (2nd not 1st, 16th not 15th).
        int anchorDay = monthlyAnchorDay(today.getDayOfMonth());
        LocalDate cursor = today.withDayOfMonth(anchorDay);
        while (ChronoUnit.DAYS.between(today, cursor) < MONTHLY_FIRST_INSTALLMENT_MIN_GAP_DAYS) {
            cursor = cursor.plusMonths(1);
        }
        for (; ; cursor = cursor.plusMonths(1)) {
            LocalDate due = rollForwardToWeekday(cursor);
            if (due.isAfter(cutoff)) break;
            dates.add(due);
        }
        return dates;
    }

    /**
     * The fixed monthly collection anchor (day of month) for a plan, chosen by
     * the booking's day of month: bookings on day 1-10 or 26-end collect on the
     * 2nd, bookings on day 11-25 collect on the 16th. Using the 2nd/16th rather
     * than the 1st/15th bakes a small buffer into every anchor.
     */
    private static int monthlyAnchorDay(int bookingDayOfMonth) {
        return (bookingDayOfMonth >= 11 && bookingDayOfMonth <= 25) ? 16 : 2;
    }
}
