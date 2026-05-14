package com.bliss.b2b.persistence;

import com.bliss.b2b.payments.MerchantPlanRules;
import java.util.Optional;
import java.util.UUID;
import org.jdbi.v3.sqlobject.config.RegisterRowMapper;
import org.jdbi.v3.sqlobject.customizer.Bind;
import org.jdbi.v3.sqlobject.statement.SqlQuery;
import org.jdbi.v3.sqlobject.statement.SqlUpdate;

@RegisterRowMapper(MerchantPlanRulesRowMapper.class)
public interface MerchantPlanRulesDao {

    @SqlQuery("SELECT * FROM merchant_plan_rules WHERE merchant_id = :merchantId")
    Optional<MerchantPlanRules> findByMerchantId(@Bind("merchantId") UUID merchantId);

    @SqlUpdate("""
            INSERT INTO merchant_plan_rules (
                merchant_id, min_lead_time_weeks, max_lead_time_weeks,
                allowed_frequencies, min_booking_amount_cents,
                max_booking_amount_cents, recommended_frequency,
                deposit_required, deposit_type, deposit_value, deposit_max_cents,
                refund_policy, refund_sliding_threshold_percent,
                cancellation_fee_enabled, cancellation_fee_type,
                cancellation_fee_value, cancellation_fee_threshold_percent,
                payment_due_policy, payment_due_custom_months,
                retry_attempts, retry_spacing_days,
                late_fee_enabled, late_fee_type, late_fee_value, late_fee_scope,
                after_retries_action
            ) VALUES (
                :merchantId, :minLeadTimeWeeks, :maxLeadTimeWeeks,
                :allowedFrequencies, :minBookingAmountCents,
                :maxBookingAmountCents, :recommendedFrequency,
                :depositRequired, :depositType, :depositValue, :depositMaxCents,
                :refundPolicy, :refundSlidingThresholdPercent,
                :cancellationFeeEnabled, :cancellationFeeType,
                :cancellationFeeValue, :cancellationFeeThresholdPercent,
                :paymentDuePolicy, :paymentDueCustomMonths,
                :retryAttempts, :retrySpacingDays,
                :lateFeeEnabled, :lateFeeType, :lateFeeValue, :lateFeeScope,
                :afterRetriesAction
            )
            ON CONFLICT (merchant_id) DO UPDATE SET
                min_lead_time_weeks = EXCLUDED.min_lead_time_weeks,
                max_lead_time_weeks = EXCLUDED.max_lead_time_weeks,
                allowed_frequencies = EXCLUDED.allowed_frequencies,
                min_booking_amount_cents = EXCLUDED.min_booking_amount_cents,
                max_booking_amount_cents = EXCLUDED.max_booking_amount_cents,
                recommended_frequency = EXCLUDED.recommended_frequency,
                deposit_required = EXCLUDED.deposit_required,
                deposit_type = EXCLUDED.deposit_type,
                deposit_value = EXCLUDED.deposit_value,
                deposit_max_cents = EXCLUDED.deposit_max_cents,
                refund_policy = EXCLUDED.refund_policy,
                refund_sliding_threshold_percent = EXCLUDED.refund_sliding_threshold_percent,
                cancellation_fee_enabled = EXCLUDED.cancellation_fee_enabled,
                cancellation_fee_type = EXCLUDED.cancellation_fee_type,
                cancellation_fee_value = EXCLUDED.cancellation_fee_value,
                cancellation_fee_threshold_percent = EXCLUDED.cancellation_fee_threshold_percent,
                payment_due_policy = EXCLUDED.payment_due_policy,
                payment_due_custom_months = EXCLUDED.payment_due_custom_months,
                retry_attempts = EXCLUDED.retry_attempts,
                retry_spacing_days = EXCLUDED.retry_spacing_days,
                late_fee_enabled = EXCLUDED.late_fee_enabled,
                late_fee_type = EXCLUDED.late_fee_type,
                late_fee_value = EXCLUDED.late_fee_value,
                late_fee_scope = EXCLUDED.late_fee_scope,
                after_retries_action = EXCLUDED.after_retries_action
            """)
    void upsert(
            @Bind("merchantId") UUID merchantId,
            @Bind("minLeadTimeWeeks") int minLeadTimeWeeks,
            @Bind("maxLeadTimeWeeks") Integer maxLeadTimeWeeks,
            @Bind("allowedFrequencies") String allowedFrequencies,
            @Bind("minBookingAmountCents") Long minBookingAmountCents,
            @Bind("maxBookingAmountCents") Long maxBookingAmountCents,
            @Bind("recommendedFrequency") String recommendedFrequency,
            @Bind("depositRequired") boolean depositRequired,
            @Bind("depositType") String depositType,
            @Bind("depositValue") Long depositValue,
            @Bind("depositMaxCents") Long depositMaxCents,
            @Bind("refundPolicy") String refundPolicy,
            @Bind("refundSlidingThresholdPercent") Integer refundSlidingThresholdPercent,
            @Bind("cancellationFeeEnabled") boolean cancellationFeeEnabled,
            @Bind("cancellationFeeType") String cancellationFeeType,
            @Bind("cancellationFeeValue") Long cancellationFeeValue,
            @Bind("cancellationFeeThresholdPercent") Integer cancellationFeeThresholdPercent,
            @Bind("paymentDuePolicy") String paymentDuePolicy,
            @Bind("paymentDueCustomMonths") Integer paymentDueCustomMonths,
            @Bind("retryAttempts") int retryAttempts,
            @Bind("retrySpacingDays") int retrySpacingDays,
            @Bind("lateFeeEnabled") boolean lateFeeEnabled,
            @Bind("lateFeeType") String lateFeeType,
            @Bind("lateFeeValue") Long lateFeeValue,
            @Bind("lateFeeScope") String lateFeeScope,
            @Bind("afterRetriesAction") String afterRetriesAction
    );
}
