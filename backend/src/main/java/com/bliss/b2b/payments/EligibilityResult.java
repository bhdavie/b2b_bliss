package com.bliss.b2b.payments;

import java.util.List;

/**
 * Outcome of running {@link PlanEligibilityService} for an appointment date.
 * {@code reason} is {@code "ok"} when eligible, otherwise an explanatory code
 * the frontend can map to copy (e.g. {@code "too_close"}).
 */
public record EligibilityResult(
        boolean eligible,
        String reason,
        long daysToAppointment,
        List<PlanOption> options
) {}
