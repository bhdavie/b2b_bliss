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
                max_booking_amount_cents, recommended_frequency
            ) VALUES (
                :merchantId, :minLeadTimeWeeks, :maxLeadTimeWeeks,
                :allowedFrequencies, :minBookingAmountCents,
                :maxBookingAmountCents, :recommendedFrequency
            )
            ON CONFLICT (merchant_id) DO UPDATE SET
                min_lead_time_weeks = EXCLUDED.min_lead_time_weeks,
                max_lead_time_weeks = EXCLUDED.max_lead_time_weeks,
                allowed_frequencies = EXCLUDED.allowed_frequencies,
                min_booking_amount_cents = EXCLUDED.min_booking_amount_cents,
                max_booking_amount_cents = EXCLUDED.max_booking_amount_cents,
                recommended_frequency = EXCLUDED.recommended_frequency
            """)
    void upsert(
            @Bind("merchantId") UUID merchantId,
            @Bind("minLeadTimeWeeks") int minLeadTimeWeeks,
            @Bind("maxLeadTimeWeeks") Integer maxLeadTimeWeeks,
            @Bind("allowedFrequencies") String allowedFrequencies,
            @Bind("minBookingAmountCents") Long minBookingAmountCents,
            @Bind("maxBookingAmountCents") Long maxBookingAmountCents,
            @Bind("recommendedFrequency") String recommendedFrequency
    );
}
