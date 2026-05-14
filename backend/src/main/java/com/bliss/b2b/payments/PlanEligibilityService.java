package com.bliss.b2b.payments;

import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;

/**
 * Determines which plan frequencies are available for a booking based on the
 * time between today and the appointment date. Pure function, deliberately
 * stateless so it can be mirrored on the frontend for UX and is trivially
 * unit-testable. Backend remains source of truth (see CLAUDE.md "Plan
 * eligibility").
 */
public class PlanEligibilityService {

    public static final int MIN_FINAL_PAYMENT_BUFFER_DAYS = 3;
    public static final int MIN_WEEKS_FOR_PLAN = 6;

    public EligibilityResult evaluate(LocalDate today, LocalDate appointmentDate, long totalAmountCents) {
        long days = ChronoUnit.DAYS.between(today, appointmentDate);
        long weeks = days / 7;

        if (weeks < MIN_WEEKS_FOR_PLAN) {
            return new EligibilityResult(false, "too_close", days, List.of());
        }

        List<PlanFrequency> eligibleFrequencies;
        if (weeks <= 7) {
            eligibleFrequencies = List.of(PlanFrequency.BIWEEKLY);
        } else if (weeks <= 12) {
            eligibleFrequencies = List.of(PlanFrequency.BIWEEKLY, PlanFrequency.MONTHLY);
        } else {
            eligibleFrequencies = List.of(PlanFrequency.MONTHLY);
        }

        List<PlanOption> options = new ArrayList<>(eligibleFrequencies.size());
        for (PlanFrequency f : eligibleFrequencies) {
            PlanOption option = buildOption(today, appointmentDate, totalAmountCents, f);
            if (option != null) options.add(option);
        }
        return new EligibilityResult(true, "ok", days, List.copyOf(options));
    }

    private PlanOption buildOption(
            LocalDate today, LocalDate appointmentDate, long totalAmountCents, PlanFrequency frequency
    ) {
        long daysToAppt = ChronoUnit.DAYS.between(today, appointmentDate);
        long usableDays = daysToAppt - MIN_FINAL_PAYMENT_BUFFER_DAYS;
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
