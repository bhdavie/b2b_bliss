package com.bliss.b2b.payments;

import java.util.List;

/**
 * Outcome of running {@link PlanEligibilityService} for an appointment date.
 * {@code reason} is {@code "ok"} when eligible, otherwise an explanatory code
 * the frontend can map to copy (e.g. {@code "too_close"}, {@code "deposit_too_high"}).
 *
 * <p>{@code depositAmountCents} is the upfront charge to fire on plan
 * acceptance; the installment options cover {@code discountedTotalAmountCents
 * - deposit}.
 *
 * <p>{@code originalTotalAmountCents} is the booking price the customer was
 * quoted (pre-discount). {@code discountedTotalAmountCents} is what the plan
 * actually charges. They are equal when the merchant has not configured a
 * plan discount.
 */
public record EligibilityResult(
        boolean eligible,
        String reason,
        long daysToAppointment,
        long depositAmountCents,
        long originalTotalAmountCents,
        long discountedTotalAmountCents,
        List<PlanOption> options
) {}
