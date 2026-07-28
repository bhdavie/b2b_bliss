package com.bliss.b2b.api;

import com.bliss.b2b.domain.PmsType;
import com.bliss.b2b.payments.MerchantPlanRules;

/**
 * The plan rules a third-party overlay needs, and nothing else.
 *
 * <p>Deliberately narrower than {@link PlanRulesView} and than
 * {@link PublicMerchantView.Policies}: this payload is readable from ANY origin
 * (see {@code PublicMerchantsResource#planRules}), so it carries only the
 * eligibility inputs the Mews overlay's {@code CONFIG.rules} consumes. No
 * Stripe publishable key, no contact email, no business identity, and none of
 * the refund / cancellation / retry / late-fee fields, which are merchant
 * policy rather than plan math and have no business on a hotel's own page.
 *
 * <p>Field names and units mirror {@code PlanRules} in frontend/lib/api.ts and
 * the overlay's own config exactly, so the overlay can assign the response
 * straight onto CONFIG.rules: money in integer cents, {@code depositValue} in
 * whole percent when {@code depositType} is "percentage",
 * {@code discountBasisPoints} in basis points, and
 * {@code paymentDueCustomMonths} in DAYS despite its name (V15 changed the unit
 * and the column name was left alone for wire compatibility).
 *
 * <p>{@code pmsType} is not a plan rule. It is here so the overlay can refuse to
 * run against a property that is not on the Mews rail rather than silently
 * decorating a booking engine it was never meant to touch.
 */
public record PublicPlanRulesView(
        int minLeadTimeWeeks,
        Integer maxLeadTimeWeeks,
        String allowedFrequencies,
        Long minBookingAmountCents,
        Long maxBookingAmountCents,
        String recommendedFrequency,
        boolean depositRequired,
        String depositType,
        Long depositValue,
        Long depositMaxCents,
        String paymentDuePolicy,
        Integer paymentDueCustomMonths,
        int discountBasisPoints,
        String pmsType
) {
    public static PublicPlanRulesView from(MerchantPlanRules rules, PmsType pmsType) {
        return new PublicPlanRulesView(
                rules.minLeadTimeWeeks(),
                rules.maxLeadTimeWeeks(),
                rules.allowedFrequencies().wire(),
                rules.minBookingAmountCents(),
                rules.maxBookingAmountCents(),
                rules.recommendedFrequency() == null ? null : rules.recommendedFrequency().wire(),
                rules.depositRequired(),
                rules.depositType() == null ? null : rules.depositType().wire(),
                rules.depositValue(),
                rules.depositMaxCents(),
                rules.paymentDuePolicy().wire(),
                rules.paymentDueCustomMonths(),
                rules.discountBasisPoints(),
                pmsType == null ? null : pmsType.wire());
    }
}
