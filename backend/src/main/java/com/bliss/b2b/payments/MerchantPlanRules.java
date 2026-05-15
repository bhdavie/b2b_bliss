package com.bliss.b2b.payments;

/**
 * Per-merchant configuration for plan eligibility and the cancellation /
 * dunning policy stack. Nullable fields mean "unset, use system behavior".
 *
 * <p>Defaults match the Phase 0-4 behavior: 6-week minimum lead, both
 * frequencies allowed, no caps, monthly recommended when both offered, no
 * deposit, full refund on cancellation, no cancellation fee, all payments
 * due by the appointment date, 3 retries spaced 3 days apart, no late fee.
 * When retries are exhausted the plan defaults to
 * {@link AfterRetriesAction#TREAT_AS_CANCELLATION}, which delegates the
 * outcome to the Refund policy + Cancellation fee above.
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
        Long depositMaxCents,
        RefundPolicy refundPolicy,
        Integer refundSlidingThresholdPercent,
        boolean cancellationFeeEnabled,
        FeeType cancellationFeeType,
        Long cancellationFeeValue,
        Integer cancellationFeeThresholdPercent,
        PaymentDuePolicy paymentDuePolicy,
        Integer paymentDueCustomMonths,
        int retryAttempts,
        int retrySpacingDays,
        boolean lateFeeEnabled,
        FeeType lateFeeType,
        Long lateFeeValue,
        LateFeeScope lateFeeScope,
        AfterRetriesAction afterRetriesAction,
        int discountBasisPoints
) {
    public static final MerchantPlanRules DEFAULTS = new MerchantPlanRules(
            6, null,
            AllowedFrequencies.BOTH,
            null, null, null,
            false, null, null, null,
            RefundPolicy.FULL, null,
            false, null, null, null,
            PaymentDuePolicy.AT_APPOINTMENT, null,
            3, 3,
            false, null, null, null,
            AfterRetriesAction.TREAT_AS_CANCELLATION,
            0
    );

    /**
     * Frequency to carry the "Recommended" badge when both options are
     * offered. Returns null when only one option is on the table.
     */
    public PlanFrequency resolveRecommended() {
        if (allowedFrequencies != AllowedFrequencies.BOTH) return null;
        if (recommendedFrequency != null) return recommendedFrequency;
        return PlanFrequency.MONTHLY;
    }

    /**
     * Phase 9 deposit math — same shape as before, kept here.
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

    /**
     * How many days before the appointment all installments must clear by.
     * Returns 0 for the default "due at appointment" policy. The eligibility
     * service combines this with the system 3-day retry buffer.
     */
    public int paymentDueOffsetDays() {
        return paymentDuePolicy.offsetDays(paymentDueCustomMonths);
    }

    /**
     * Applies the merchant's plan discount to a booking total. 1000 bp == 10%.
     * Floors the result so we never overcharge — at worst the merchant eats
     * a fractional cent of "intended discount" they configured.
     */
    public long applyDiscountCents(long totalCents) {
        if (discountBasisPoints <= 0 || totalCents <= 0) return totalCents;
        return totalCents * (10_000L - discountBasisPoints) / 10_000L;
    }
}
