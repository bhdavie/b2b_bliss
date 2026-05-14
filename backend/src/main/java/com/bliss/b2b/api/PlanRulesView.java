package com.bliss.b2b.api;

import com.bliss.b2b.payments.MerchantPlanRules;

public record PlanRulesView(
        int minLeadTimeWeeks,
        Integer maxLeadTimeWeeks,
        String allowedFrequencies,
        Long minBookingAmountCents,
        Long maxBookingAmountCents,
        String recommendedFrequency
) {
    public static PlanRulesView from(MerchantPlanRules rules) {
        return new PlanRulesView(
                rules.minLeadTimeWeeks(),
                rules.maxLeadTimeWeeks(),
                rules.allowedFrequencies().wire(),
                rules.minBookingAmountCents(),
                rules.maxBookingAmountCents(),
                rules.recommendedFrequency() == null ? null : rules.recommendedFrequency().wire()
        );
    }
}
