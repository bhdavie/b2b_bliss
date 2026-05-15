package com.bliss.b2b.service;

import com.bliss.b2b.payments.MerchantPlanRules;
import com.bliss.b2b.persistence.MerchantPlanRulesDao;
import java.util.UUID;

/**
 * Thin wrapper that turns "no rules stored" into {@link MerchantPlanRules#DEFAULTS}.
 * Every caller that needs to evaluate eligibility goes through this so the
 * defaulting logic lives in exactly one place.
 */
public class MerchantPlanRulesService {

    private final MerchantPlanRulesDao dao;

    public MerchantPlanRulesService(MerchantPlanRulesDao dao) {
        this.dao = dao;
    }

    public MerchantPlanRules forMerchant(UUID merchantId) {
        return dao.findByMerchantId(merchantId).orElse(MerchantPlanRules.DEFAULTS);
    }

    public void save(UUID merchantId, MerchantPlanRules rules) {
        dao.upsert(
                merchantId,
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
                rules.afterRetriesAction().wire(),
                rules.discountBasisPoints()
        );
    }
}
