package com.bliss.b2b.payments;

import java.util.List;

/**
 * Outcome of running {@link PlanEligibilityService} for an appointment date.
 * {@code reason} is {@code "ok"} when eligible, otherwise an explanatory code
 * the frontend can map to copy (e.g. {@code "too_close"}, {@code "deposit_too_high"}).
 *
 * <p>{@code depositAmountCents} is the upfront charge to fire on plan
 * acceptance; the installment options cover {@code total - deposit}.
 */
public record EligibilityResult(
        boolean eligible,
        String reason,
        long daysToAppointment,
        long depositAmountCents,
        List<PlanOption> options
) {}
