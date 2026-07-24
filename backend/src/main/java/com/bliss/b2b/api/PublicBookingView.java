package com.bliss.b2b.api;

import com.bliss.b2b.domain.Booking;
import com.bliss.b2b.domain.Merchant;
import com.bliss.b2b.domain.PmsType;
import com.bliss.b2b.payments.EligibilityResult;
import com.bliss.b2b.payments.MerchantPlanRules;
import com.bliss.b2b.payments.PlanFrequency;
import java.time.LocalDate;
import java.util.List;

/**
 * Public-facing view of a booking, served unauthenticated to the hosted page.
 * Intentionally narrower than {@link BookingView}: no merchant email, no
 * internal status enum values that aren't useful to a consumer.
 */
public record PublicBookingView(
        MerchantContext merchant,
        Service service,
        Eligibility eligibility,
        List<Plan> planOptions,
        Stripe stripe,
        Policies policies,
        String status,
        String rail
) {
    /**
     * Which card-capture rail the hosted page should use: {@code "mews"} for a
     * Mews-rail property, else {@code "stripe"} when Stripe is configured, else
     * {@code "demo"}.
     */
    static String railOf(Merchant merchant, boolean stripeConfigured) {
        if (merchant.pmsType() == PmsType.MEWS) {
            return "mews";
        }
        return stripeConfigured ? "stripe" : "demo";
    }

    public record MerchantContext(
            String slug,
            String businessName,
            String businessType,
            String brandColorPrimary,
            String logoUrl,
            String contactEmail
    ) {}

    public record Service(
            String name,
            String description,
            long totalAmountCents,
            LocalDate appointmentDate,
            String cancellationPolicy,
            String customerNameHint,
            String customerEmailHint
    ) {}

    public record Eligibility(
            boolean eligible,
            String reason,
            long daysToAppointment,
            long depositAmountCents,
            long originalTotalAmountCents,
            long discountedTotalAmountCents
    ) {}

    public record Plan(
            String frequency,
            int numPayments,
            long perPaymentAmountCents,
            long finalPaymentAmountCents,
            List<LocalDate> dueDates,
            boolean recommended
    ) {}

    public record Stripe(
            boolean configured,
            String publishableKey,
            // Connected Standard account for direct charges. Non-null once the
            // property finishes Connect onboarding; the frontend passes it to
            // Stripe.js as {@code stripeAccount} so card capture and the charge
            // land on the property's own account. Null = platform (current).
            String connectedAccountId
    ) {}

    /**
     * Customer-facing slice of the merchant's policy stack. The hosted page
     * uses these to render the "Cancellation policy" trust-signal block.
     * Refund-policy and fee details are passed through verbatim so the
     * frontend owns the copy.
     */
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
            String afterRetriesAction
    ) {}

    public static PublicBookingView build(
            Merchant merchant,
            Booking booking,
            EligibilityResult eligibility,
            MerchantPlanRules rules,
            boolean stripeConfigured,
            String stripePublishableKey,
            String connectedAccountId
    ) {
        PlanFrequency recommended = rules.resolveRecommended();
        List<Plan> options = eligibility.options().stream()
                .map(o -> new Plan(
                        o.frequency().wire(),
                        o.numPayments(),
                        o.perPaymentAmountCents(),
                        o.finalPaymentAmountCents(),
                        o.dueDates(),
                        recommended != null && o.frequency() == recommended))
                .toList();
        Policies policies = new Policies(
                rules.refundPolicy().wire(),
                rules.refundSlidingThresholdPercent(),
                rules.cancellationFeeEnabled(),
                rules.cancellationFeeType() == null ? null : rules.cancellationFeeType().wire(),
                rules.cancellationFeeValue(),
                rules.cancellationFeeThresholdPercent(),
                rules.paymentDuePolicy().wire(),
                rules.paymentDueCustomMonths(),
                rules.retryAttempts(),
                rules.retrySpacingDays(),
                rules.lateFeeEnabled(),
                rules.lateFeeType() == null ? null : rules.lateFeeType().wire(),
                rules.lateFeeValue(),
                rules.lateFeeScope() == null ? null : rules.lateFeeScope().wire(),
                rules.afterRetriesAction().wire()
        );
        return new PublicBookingView(
                new MerchantContext(
                        merchant.slug(),
                        merchant.businessName(),
                        merchant.businessType(),
                        null,
                        null,
                        merchant.email()),
                new Service(
                        booking.serviceName(),
                        booking.serviceDescription(),
                        // Surface the published price to the consumer page;
                        // a row that has had the discount applied still
                        // exposes the pre-discount total via originalTotal.
                        booking.originalTotalAmountCents() != null
                                ? booking.originalTotalAmountCents()
                                : booking.totalAmountCents(),
                        booking.appointmentDate(),
                        booking.cancellationPolicy(),
                        booking.customerNameHint(),
                        booking.customerEmailHint()),
                new Eligibility(
                        eligibility.eligible(),
                        eligibility.reason(),
                        eligibility.daysToAppointment(),
                        eligibility.depositAmountCents(),
                        eligibility.originalTotalAmountCents(),
                        eligibility.discountedTotalAmountCents()),
                options,
                new Stripe(
                        stripeConfigured,
                        stripeConfigured ? stripePublishableKey : null,
                        stripeConfigured ? connectedAccountId : null),
                policies,
                booking.status().wire(),
                railOf(merchant, stripeConfigured)
        );
    }
}
