package com.bliss.b2b.persistence;

import com.bliss.b2b.domain.CloudbedsConnection;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.jdbi.v3.sqlobject.config.RegisterRowMapper;
import org.jdbi.v3.sqlobject.customizer.Bind;
import org.jdbi.v3.sqlobject.statement.SqlQuery;
import org.jdbi.v3.sqlobject.statement.SqlUpdate;

/**
 * Per-property Cloudbeds OAuth connections. One row per merchant; the charge pass
 * reads it (via {@link com.bliss.b2b.integration.pms.CloudbedsAdapterFactory}) so
 * each property charges against its own tokens, and the OAuth callback writes it.
 * Mirrors {@link MerchantMewsConnectionDao} / {@link MerchantStripeConnectionDao}.
 */
@RegisterRowMapper(CloudbedsConnectionRowMapper.class)
public interface MerchantCloudbedsConnectionDao {

    @SqlQuery("SELECT * FROM merchant_cloudbeds_connections WHERE merchant_id = :merchantId")
    Optional<CloudbedsConnection> findByMerchant(@Bind("merchantId") UUID merchantId);

    /**
     * Inserts or replaces a property's connection after a successful OAuth code
     * exchange + property identification.
     */
    @SqlUpdate("""
            INSERT INTO merchant_cloudbeds_connections (
                merchant_id, property_id, property_name, currency,
                access_token, refresh_token, access_token_expires_at,
                status, connected_at
            ) VALUES (
                :merchantId, :propertyId, :propertyName, :currency,
                :accessToken, :refreshToken, :accessTokenExpiresAt,
                'connected', :connectedAt
            )
            ON CONFLICT (merchant_id) DO UPDATE SET
                property_id = EXCLUDED.property_id,
                property_name = EXCLUDED.property_name,
                currency = EXCLUDED.currency,
                access_token = EXCLUDED.access_token,
                refresh_token = EXCLUDED.refresh_token,
                access_token_expires_at = EXCLUDED.access_token_expires_at,
                status = 'connected',
                connected_at = COALESCE(merchant_cloudbeds_connections.connected_at, EXCLUDED.connected_at)
            """)
    void upsert(
            @Bind("merchantId") UUID merchantId,
            @Bind("propertyId") String propertyId,
            @Bind("propertyName") String propertyName,
            @Bind("currency") String currency,
            @Bind("accessToken") String accessToken,
            @Bind("refreshToken") String refreshToken,
            @Bind("accessTokenExpiresAt") Instant accessTokenExpiresAt,
            @Bind("connectedAt") Instant connectedAt
    );

    /**
     * Rewrites just the tokens after a transparent refresh. Cloudbeds may rotate
     * the refresh token, so both are stored.
     */
    @SqlUpdate("""
            UPDATE merchant_cloudbeds_connections
            SET access_token = :accessToken,
                refresh_token = :refreshToken,
                access_token_expires_at = :accessTokenExpiresAt,
                status = 'connected'
            WHERE merchant_id = :merchantId
            """)
    int updateTokens(
            @Bind("merchantId") UUID merchantId,
            @Bind("accessToken") String accessToken,
            @Bind("refreshToken") String refreshToken,
            @Bind("accessTokenExpiresAt") Instant accessTokenExpiresAt
    );

    /** Marks the connection revoked when a refresh permanently fails. */
    @SqlUpdate("""
            UPDATE merchant_cloudbeds_connections
            SET status = 'revoked'
            WHERE merchant_id = :merchantId
            """)
    int markRevoked(@Bind("merchantId") UUID merchantId);

    @SqlUpdate("DELETE FROM merchant_cloudbeds_connections WHERE merchant_id = :merchantId")
    int deleteByMerchant(@Bind("merchantId") UUID merchantId);
}
