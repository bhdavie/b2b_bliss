package com.bliss.b2b.payments;

/**
 * The configurable knobs a merchant exposes for their own plan eligibility.
 * Nullable fields ({@code maxLeadTimeWeeks}, amount limits,
 * {@code recommendedFrequency}, deposit fields) mean "unset, use system
 * behavior" — not zero.
 *
 * <p>Defaults match the constants used by Phase 0-4: 6-week minimum, both
 * frequencies allowed, no max lead time, no amount limits, recommended
 * frequency auto-resolves to monthly when both are offered, no deposit.
 */
public record MerchantPlanRules(
        int minLeadTimeWeeks,
        Integer maxLeadTimeWeeks,
        AllowedFrequencies allowedFrequencies,
        Long minBookingAmountCents,
        Long maxBookingAmountCents,
        PlanFrequency recommendedFrequency,
        boolean depositRequired,
        DepositType depositType,
        Long depositValue,
        Long depositMaxCents
) {
    public static final MerchantPlanRules DEFAULTS = new MerchantPlanRules(
            6,
            null,
            AllowedFrequencies.BOTH,
            null,
            null,
            null,
            false,
            null,
            null,
            null
    );

    /**
     * Resolves which frequency carries the "Recommended" badge when both are
     * offered. Returns null when only a single option is available — the
     * caller should not render a badge in that case.
     */
    public PlanFrequency resolveRecommended() {
        if (allowedFrequencies != AllowedFrequencies.BOTH) return null;
        if (recommendedFrequency != null) return recommendedFrequency;
        return PlanFrequency.MONTHLY;
    }

    /**
     * Computes the deposit charge for a booking of the given total. Returns
     * {@code 0} when no deposit is required. The result is capped at the
     * merchant's optional {@code depositMaxCents} and at the booking total
     * (so a fixed deposit larger than the booking does not exceed it).
     *
     * <p>The validation layer rejects {@code percentage=100}, so this can
     * only return a value equal to the booking total when a {@code fixed}
     * deposit happens to match or exceed the booking — that case is then
     * surfaced as {@code reason="deposit_too_high"} in
     * {@link PlanEligibilityService} rather than producing a one-charge
     * "plan".
     */
    public long computeDepositCents(long totalAmountCents) {
        if (!depositRequired || depositType == null || depositValue == null) return 0;
        long raw = switch (depositType) {
            case PERCENTAGE -> totalAmountCents * depositValue / 100L;
            case FIXED -> depositValue;
        };
        if (depositMaxCents != null) raw = Math.min(raw, depositMaxCents);
        return Math.max(0L, Math.min(raw, totalAmountCents));
    }
}
