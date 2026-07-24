package com.bliss.b2b.persistence;

import com.bliss.b2b.domain.StripeConnection;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.jdbi.v3.sqlobject.config.RegisterRowMapper;
import org.jdbi.v3.sqlobject.customizer.Bind;
import org.jdbi.v3.sqlobject.statement.SqlQuery;
import org.jdbi.v3.sqlobject.statement.SqlUpdate;

/**
 * Per-property Stripe Connect *Standard* accounts. One row per merchant; the pay
 * flow reads it (via {@link com.bliss.b2b.integration.StripeConnectResolver}) so
 * each property charges as a direct charge on its own connected account, and
 * onboarding writes it when a property starts and completes Standard onboarding.
 * Mirrors {@link MerchantMewsConnectionDao}.
 */
@RegisterRowMapper(StripeConnectionRowMapper.class)
public interface MerchantStripeConnectionDao {

    @SqlQuery("SELECT * FROM merchant_stripe_connections WHERE merchant_id = :merchantId")
    Optional<StripeConnection> findByMerchant(@Bind("merchantId") UUID merchantId);

    @SqlQuery("SELECT * FROM merchant_stripe_connections WHERE stripe_account_id = :stripeAccountId")
    Optional<StripeConnection> findByStripeAccountId(@Bind("stripeAccountId") String stripeAccountId);

    /**
     * Records the connected account when a property starts onboarding. Called
     * once per property; a second start reuses the stored account rather than
     * minting a new one, so this only inserts when absent.
     */
    @SqlUpdate("""
            INSERT INTO merchant_stripe_connections (
                merchant_id, stripe_account_id, connect_status, charges_enabled
            ) VALUES (
                :merchantId, :stripeAccountId, :connectStatus, :chargesEnabled
            )
            ON CONFLICT (merchant_id) DO UPDATE SET
                stripe_account_id = EXCLUDED.stripe_account_id,
                connect_status = EXCLUDED.connect_status,
                charges_enabled = EXCLUDED.charges_enabled
            """)
    void upsertAccount(
            @Bind("merchantId") UUID merchantId,
            @Bind("stripeAccountId") String stripeAccountId,
            @Bind("connectStatus") String connectStatus,
            @Bind("chargesEnabled") boolean chargesEnabled
    );

    /**
     * Updates a property's onboarding status. {@code connectedAt} is set the
     * first time charges become enabled and left as-is otherwise (COALESCE keeps
     * the earliest completion timestamp).
     */
    @SqlUpdate("""
            UPDATE merchant_stripe_connections
            SET connect_status = :connectStatus,
                charges_enabled = :chargesEnabled,
                connected_at = COALESCE(connected_at, :connectedAt)
            WHERE merchant_id = :merchantId
            """)
    int updateStatus(
            @Bind("merchantId") UUID merchantId,
            @Bind("connectStatus") String connectStatus,
            @Bind("chargesEnabled") boolean chargesEnabled,
            @Bind("connectedAt") Instant connectedAt
    );

    /** Removes a property's stored Standard connection. Returns rows deleted (0 or 1). */
    @SqlUpdate("DELETE FROM merchant_stripe_connections WHERE merchant_id = :merchantId")
    int deleteByMerchant(@Bind("merchantId") UUID merchantId);
}
