package com.bliss.b2b.persistence;

import com.bliss.b2b.domain.MewsConnection;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.jdbi.v3.sqlobject.config.RegisterRowMapper;
import org.jdbi.v3.sqlobject.customizer.Bind;
import org.jdbi.v3.sqlobject.statement.SqlQuery;
import org.jdbi.v3.sqlobject.statement.SqlUpdate;

/**
 * Per-property Mews Connector credentials. One row per merchant; the charge pass
 * reads it (via MewsAdapterFactory) so each property charges against its own
 * tokens, and onboarding writes it when a property validates its connection.
 */
@RegisterRowMapper(MewsConnectionRowMapper.class)
public interface MerchantMewsConnectionDao {

    @SqlQuery("SELECT * FROM merchant_mews_connections WHERE merchant_id = :merchantId")
    Optional<MewsConnection> findByMerchant(@Bind("merchantId") UUID merchantId);

    /**
     * Inserts or replaces a property's connection with a validated enterprise
     * identity. Called only after {@code configuration/get} succeeds, so
     * {@code validatedAt} is always set here.
     */
    @SqlUpdate("""
            INSERT INTO merchant_mews_connections (
                merchant_id, platform_url, client_token, access_token,
                enterprise_id, enterprise_name, currency, validated_at
            ) VALUES (
                :merchantId, :platformUrl, :clientToken, :accessToken,
                :enterpriseId, :enterpriseName, :currency, :validatedAt
            )
            ON CONFLICT (merchant_id) DO UPDATE SET
                platform_url = EXCLUDED.platform_url,
                client_token = EXCLUDED.client_token,
                access_token = EXCLUDED.access_token,
                enterprise_id = EXCLUDED.enterprise_id,
                enterprise_name = EXCLUDED.enterprise_name,
                currency = EXCLUDED.currency,
                validated_at = EXCLUDED.validated_at
            """)
    void upsertValidated(
            @Bind("merchantId") UUID merchantId,
            @Bind("platformUrl") String platformUrl,
            @Bind("clientToken") String clientToken,
            @Bind("accessToken") String accessToken,
            @Bind("enterpriseId") String enterpriseId,
            @Bind("enterpriseName") String enterpriseName,
            @Bind("currency") String currency,
            @Bind("validatedAt") Instant validatedAt
    );

    /** Removes a property's stored Mews connection. Returns rows deleted (0 or 1). */
    @SqlUpdate("DELETE FROM merchant_mews_connections WHERE merchant_id = :merchantId")
    int deleteByMerchant(@Bind("merchantId") UUID merchantId);
}
