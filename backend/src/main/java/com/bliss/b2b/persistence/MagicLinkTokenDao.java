package com.bliss.b2b.persistence;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.jdbi.v3.sqlobject.customizer.Bind;
import org.jdbi.v3.sqlobject.statement.SqlQuery;
import org.jdbi.v3.sqlobject.statement.SqlUpdate;

public interface MagicLinkTokenDao {

    @SqlUpdate("""
            INSERT INTO magic_link_tokens (merchant_id, token_hash, expires_at)
            VALUES (:merchantId, :tokenHash, :expiresAt)
            """)
    void insert(
            @Bind("merchantId") UUID merchantId,
            @Bind("tokenHash") String tokenHash,
            @Bind("expiresAt") Instant expiresAt
    );

    @SqlQuery("""
            SELECT merchant_id
            FROM magic_link_tokens
            WHERE token_hash = :tokenHash
              AND consumed_at IS NULL
              AND expires_at > :now
            """)
    Optional<UUID> findActiveMerchantId(
            @Bind("tokenHash") String tokenHash,
            @Bind("now") Instant now
    );

    @SqlUpdate("""
            UPDATE magic_link_tokens
            SET consumed_at = :now
            WHERE token_hash = :tokenHash
              AND consumed_at IS NULL
            """)
    int consume(@Bind("tokenHash") String tokenHash, @Bind("now") Instant now);

    @SqlUpdate("""
            DELETE FROM magic_link_tokens
            WHERE expires_at < :cutoff
            """)
    int deleteExpired(@Bind("cutoff") Instant cutoff);
}
