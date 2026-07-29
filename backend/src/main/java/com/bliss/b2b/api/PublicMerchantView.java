package com.bliss.b2b.api;

/**
 * Public-facing merchant lookup payload for the customer-initiated
 * checkout page. Mirrors the shape of {@link PublicBookingView} (same
 * merchant context block + policy summary + Stripe configured flag)
 * so the frontend can reuse the existing consumer components.
 */
public record PublicMerchantView(
        MerchantContext merchant,
        Policies policies,
        Stripe stripe,
        String rail
) {
    public record MerchantContext(
            String slug,
            String businessName,
            String businessType,
            String brandColorPrimary,
            String logoUrl,
            String contactEmail
    ) {}

    public record Policies(
            String refundPolicy,
            Integer refundSlidingThresholdPercent,
            boolean cancellationFeeEnabled,
            String cancellationFeeType,
            Long cancellationFeeValue,
            Integer cancellationFeeThresholdPercent,
            String paymentDuePolicy,
            Integer paymentDueCustomMonths,
            int retryAttempts,
            int retrySpacingDays,
            boolean lateFeeEnabled,
            String lateFeeType,
            Long lateFeeValue,
            String lateFeeScope,
            String afterRetriesAction,
            String allowedFrequencies,
            String recommendedFrequency,
            int minLeadTimeWeeks,
            Integer maxLeadTimeWeeks,
            Long minBookingAmountCents,
            Long maxBookingAmountCents,
            boolean depositRequired,
            String depositType,
            Long depositValue,
            Long depositMaxCents,
            int discountBasisPoints,
            /**
             * ISO yyyy-MM-dd dates on which no plan is offered, matched against
             * the guest's stay. Here as well as on {@link PublicPlanRulesView}
             * because the hosted funnels read their rules from this payload.
             */
            java.util.List<String> blackoutDates
    ) {}

    public record Stripe(
            boolean configured,
            String publishableKey,
            boolean chargesEnabled,
            // Connected Standard account for direct charges (null = platform).
            // The frontend passes it to Stripe.js as {@code stripeAccount}.
            String connectedAccountId
    ) {}
}
