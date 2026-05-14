package com.bliss.b2b.payments;

/**
 * The configurable knobs a merchant exposes for their own plan eligibility.
 * Nullable fields ({@code maxLeadTimeWeeks}, amount limits,
 * {@code recommendedFrequency}) mean "unset, use system behavior" — not zero.
 *
 * <p>Defaults match the constants used by Phase 0-4: 6-week minimum, both
 * frequencies allowed, no max lead time, no amount limits, recommended
 * frequency auto-resolves to monthly when both are offered.
 */
public record MerchantPlanRules(
        int minLeadTimeWeeks,
        Integer maxLeadTimeWeeks,
        AllowedFrequencies allowedFrequencies,
        Long minBookingAmountCents,
        Long maxBookingAmountCents,
        PlanFrequency recommendedFrequency
) {
    public static final MerchantPlanRules DEFAULTS = new MerchantPlanRules(
            6,
            null,
            AllowedFrequencies.BOTH,
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
}
