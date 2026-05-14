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
 * <p>{@link MerchantPlanRules#DEFAULTS} produces the original Phase 0 behavior
 * with two relaxations: an offering of "both frequencies" no longer collapses
 * to biweekly-only in the 6-7w window or monthly-only in the 13+w window.
 * If the merchant wants those tighter behaviors they configure rules.
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
            return new EligibilityResult(false, "too_close", days, List.of());
        }
        if (rules.maxLeadTimeWeeks() != null && weeks > rules.maxLeadTimeWeeks()) {
            return new EligibilityResult(false, "too_far", days, List.of());
        }
        if (rules.minBookingAmountCents() != null && totalAmountCents < rules.minBookingAmountCents()) {
            return new EligibilityResult(false, "amount_too_low", days, List.of());
        }
        if (rules.maxBookingAmountCents() != null && totalAmountCents > rules.maxBookingAmountCents()) {
            return new EligibilityResult(false, "amount_too_high", days, List.of());
        }

        List<PlanOption> options = new ArrayList<>();
        for (PlanFrequency f : rules.allowedFrequencies().frequencies()) {
            PlanOption option = buildOption(today, appointmentDate, totalAmountCents, f);
            if (option != null) options.add(option);
        }
        if (options.isEmpty()) {
            // Merchant rules allow this booking in principle but no allowed
            // frequency yields a plan with at least 2 payments before the
            // appointment date. Customer sees a "too close" style state.
            return new EligibilityResult(false, "no_plan_fits", days, List.of());
        }
        return new EligibilityResult(true, "ok", days, List.copyOf(options));
    }

    private PlanOption buildOption(
            LocalDate today, LocalDate appointmentDate, long totalAmountCents, PlanFrequency frequency
    ) {
        long daysToAppt = ChronoUnit.DAYS.between(today, appointmentDate);
        long usableDays = daysToAppt - MIN_FINAL_PAYMENT_BUFFER_DAYS;
        if (usableDays < 0) return null;
        long intervals = usableDays / frequency.days();
        int numPayments = (int) (1 + intervals);
        if (numPayments < 2) return null;

        long perPayment;
        long finalPayment;
        if (totalAmountCents > 0) {
            perPayment = totalAmountCents / numPayments;
            long remainder = totalAmountCents - perPayment * numPayments;
            finalPayment = perPayment + remainder;
        } else {
            perPayment = 0;
            finalPayment = 0;
        }

        List<LocalDate> dueDates = new ArrayList<>(numPayments);
        for (int i = 0; i < numPayments; i++) {
            dueDates.add(today.plusDays((long) i * frequency.days()));
        }
        return new PlanOption(frequency, numPayments, perPayment, finalPayment, List.copyOf(dueDates));
    }
}
