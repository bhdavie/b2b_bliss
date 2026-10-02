package com.bliss.b2b.persistence;

import com.bliss.b2b.domain.BlissSettings;
import com.bliss.b2b.payments.PayoutMode;
import com.bliss.b2b.payments.ReleasePolicy;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.jdbi.v3.sqlobject.customizer.Bind;
import org.jdbi.v3.sqlobject.statement.SqlQuery;
import org.jdbi.v3.sqlobject.statement.SqlUpdate;

public interface BlissSettingsDao {

    @SqlQuery("""
            SELECT merchant_id, payout_mode, release_policy, chargeback_buffer_days, bliss_enabled_at,
                   fee_service_id, fee_tax_code, fee_accounting_category_id, ledger_payment_type,
                   weekly_summary
            FROM property_bliss_settings WHERE merchant_id = :merchantId
            """)
    @org.jdbi.v3.sqlobject.config.RegisterRowMapper(BlissSettingsDao.Mapper.class)
    Optional<BlissSettings> find(@Bind("merchantId") UUID merchantId);

    /** Creates the row of defaults if there is none. Returns rows inserted (0 or 1). */
    @SqlUpdate("""
            INSERT INTO property_bliss_settings (merchant_id) VALUES (:merchantId)
            ON CONFLICT (merchant_id) DO NOTHING
            """)
    int insertDefaults(@Bind("merchantId") UUID merchantId);

    /** Marks Bliss switched on; keeps the first time if it already was. */
    @SqlUpdate("""
            UPDATE property_bliss_settings
            SET bliss_enabled_at = COALESCE(bliss_enabled_at, :at)
            WHERE merchant_id = :merchantId
            """)
    int markEnabled(@Bind("merchantId") UUID merchantId, @Bind("at") Instant at);

    @SqlUpdate("""
            UPDATE property_bliss_settings
            SET payout_mode = :payoutMode,
                release_policy = :releasePolicy,
                chargeback_buffer_days = :bufferDays
            WHERE merchant_id = :merchantId
            """)
    int update(@Bind("merchantId") UUID merchantId,
               @Bind("payoutMode") String payoutMode,
               @Bind("releasePolicy") String releasePolicy,
               @Bind("bufferDays") int chargebackBufferDays);

    /** Sets where and how the Bliss fee line posts; null clears a value. */
    @SqlUpdate("""
            UPDATE property_bliss_settings
            SET fee_service_id = :serviceId,
                fee_tax_code = :taxCode,
                fee_accounting_category_id = :accountingCategoryId
            WHERE merchant_id = :merchantId
            """)
    int updateFeeLine(@Bind("merchantId") UUID merchantId,
                      @Bind("serviceId") String serviceId,
                      @Bind("taxCode") String taxCode,
                      @Bind("accountingCategoryId") String accountingCategoryId);

    /** Sets the Mews external payment type hold-mode ledger payments post as; null clears it. */
    @SqlUpdate("UPDATE property_bliss_settings SET ledger_payment_type = :type WHERE merchant_id = :merchantId")
    int updateLedgerPaymentType(@Bind("merchantId") UUID merchantId, @Bind("type") String type);

    @SqlUpdate("UPDATE property_bliss_settings SET weekly_summary = :on WHERE merchant_id = :merchantId")
    int updateWeeklySummary(@Bind("merchantId") UUID merchantId, @Bind("on") boolean on);

    final class Mapper implements org.jdbi.v3.core.mapper.RowMapper<BlissSettings> {
        @Override
        public BlissSettings map(java.sql.ResultSet rs, org.jdbi.v3.core.statement.StatementContext ctx)
                throws java.sql.SQLException {
            java.sql.Timestamp enabled = rs.getTimestamp("bliss_enabled_at");
            return new BlissSettings(
                    (UUID) rs.getObject("merchant_id"),
                    PayoutMode.fromWire(rs.getString("payout_mode")),
                    ReleasePolicy.fromWire(rs.getString("release_policy")),
                    rs.getInt("chargeback_buffer_days"),
                    enabled == null ? null : enabled.toInstant(),
                    rs.getString("fee_service_id"),
                    rs.getString("fee_tax_code"),
                    rs.getString("fee_accounting_category_id"),
                    rs.getString("ledger_payment_type"),
                    rs.getBoolean("weekly_summary"),
                    true);
        }
    }
}
