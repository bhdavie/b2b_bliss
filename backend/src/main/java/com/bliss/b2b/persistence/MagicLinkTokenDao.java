package com.bliss.b2b.persistence;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.jdbi.v3.sqlobject.customizer.Bind;
import org.jdbi.v3.sqlobject.statement.SqlQuery;
import org.jdbi.v3.sqlobject.statement.SqlUpdate;

public interface MagicLinkTokenDao {

    /**
     * Merchant link. subject_type is written explicitly rather than left to the
     * column default so the two insert methods read as a matched pair, and so a
     * later default change cannot silently retype merchant tokens.
     */
    @SqlUpdate("""
            INSERT INTO magic_link_tokens (subject_type, merchant_id, token_hash, expires_at)
            VALUES ('merchant', :merchantId, :tokenHash, :expiresAt)
            """)
    void insert(
            @Bind("merchantId") UUID merchantId,
            @Bind("tokenHash") String tokenHash,
            @Bind("expiresAt") Instant expiresAt
    );

    /** Guest link. Same token, TTL and consume semantics; different subject. */
    @SqlUpdate("""
            INSERT INTO magic_link_tokens (subject_type, customer_id, token_hash, expires_at)
            VALUES ('customer', :customerId, :tokenHash, :expiresAt)
            """)
    void insertForCustomer(
            @Bind("customerId") UUID customerId,
            @Bind("tokenHash") String tokenHash,
            @Bind("expiresAt") Instant expiresAt
    );

    /**
     * The subject_type filter is the scope check, and it is deliberately in the
     * WHERE clause rather than left to the CHECK constraint alone: a guest token
     * presented to the merchant verify endpoint returns empty here, so it can
     * never be consumed as a merchant session even though the row is valid.
     */
    @SqlQuery("""
            SELECT merchant_id
            FROM magic_link_tokens
            WHERE token_hash = :tokenHash
              AND subject_type = 'merchant'
              AND consumed_at IS NULL
              AND expires_at > :now
            """)
    Optional<UUID> findActiveMerchantId(
            @Bind("tokenHash") String tokenHash,
            @Bind("now") Instant now
    );

    /** Mirror of findActiveMerchantId, scoped the other way. */
    @SqlQuery("""
            SELECT customer_id
            FROM magic_link_tokens
            WHERE token_hash = :tokenHash
              AND subject_type = 'customer'
              AND consumed_at IS NULL
              AND expires_at > :now
            """)
    Optional<UUID> findActiveCustomerId(
            @Bind("tokenHash") String tokenHash,
            @Bind("now") Instant now
    );

    /**
     * Consume is shared. It does not need a subject filter: the caller has
     * already proved the subject with the scoped find above, and token_hash is
     * unique, so there is exactly one row this can touch.
     */
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

    /** Used to drop a token whose email could not be delivered. */
    @SqlUpdate("""
            DELETE FROM magic_link_tokens
            WHERE token_hash = :tokenHash
            """)
    int deleteByHash(@Bind("tokenHash") String tokenHash);
}
