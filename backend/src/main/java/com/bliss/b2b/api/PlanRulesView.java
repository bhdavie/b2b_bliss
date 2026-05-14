package com.bliss.b2b.api;

import com.bliss.b2b.payments.MerchantPlanRules;

public record PlanRulesView(
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
) {
    public static PlanRulesView from(MerchantPlanRules rules) {
        return new PlanRulesView(
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
    }
}
