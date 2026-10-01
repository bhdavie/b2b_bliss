package com.bliss.b2b.persistence;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.jdbi.v3.sqlobject.config.RegisterConstructorMapper;
import org.jdbi.v3.sqlobject.customizer.Bind;
import org.jdbi.v3.sqlobject.statement.SqlQuery;
import org.jdbi.v3.sqlobject.statement.SqlUpdate;

/** What Bliss writes to Mews folios, once each (V39). */
public interface FolioPostingDao {

    /** Claims a posting by its key. Returns 0 when it already exists, so it is never posted twice. */
    @SqlUpdate("""
            INSERT INTO folio_postings (booking_id, kind, idempotency_key, amount_minor, currency)
            VALUES (:bookingId, :kind, :key, :amount, :currency)
            ON CONFLICT (idempotency_key) DO NOTHING
            """)
    int claim(@Bind("bookingId") UUID bookingId, @Bind("kind") String kind, @Bind("key") String key,
            @Bind("amount") long amountMinor, @Bind("currency") String currency);

    @SqlQuery("SELECT * FROM folio_postings WHERE idempotency_key = :key")
    @RegisterConstructorMapper(Posting.class)
    Optional<Posting> find(@Bind("key") String key);

    /** Pending fee lines for one property, oldest first. */
    default List<Posting> pendingForMerchant(UUID merchantId) {
        return pendingForMerchant(merchantId, "fee_line");
    }

    /** Pending postings of one kind for one property, oldest first. */
    @SqlQuery("""
            SELECT fp.* FROM folio_postings fp JOIN bookings b ON b.id = fp.booking_id
            WHERE fp.status = 'pending' AND b.merchant_id = :merchantId AND fp.kind = :kind
            ORDER BY fp.created_at
            """)
    @RegisterConstructorMapper(Posting.class)
    List<Posting> pendingForMerchant(@Bind("merchantId") UUID merchantId, @Bind("kind") String kind);

    @SqlUpdate("""
            UPDATE folio_postings SET status = 'posted', mews_id = :mewsId, posted_at = :at,
                   attempts = attempts + 1, last_error = NULL
            WHERE id = :id AND status = 'pending'
            """)
    int markPosted(@Bind("id") UUID id, @Bind("mewsId") String mewsId, @Bind("at") Instant at);

    @SqlUpdate("UPDATE folio_postings SET attempts = attempts + 1, last_error = :error WHERE id = :id")
    int recordFailure(@Bind("id") UUID id, @Bind("error") String error);

    record Posting(
            @org.jdbi.v3.core.mapper.reflect.ColumnName("id") UUID id,
            @org.jdbi.v3.core.mapper.reflect.ColumnName("booking_id") UUID bookingId,
            @org.jdbi.v3.core.mapper.reflect.ColumnName("kind") String kind,
            @org.jdbi.v3.core.mapper.reflect.ColumnName("idempotency_key") String idempotencyKey,
            @org.jdbi.v3.core.mapper.reflect.ColumnName("amount_minor") long amountMinor,
            @org.jdbi.v3.core.mapper.reflect.ColumnName("currency") String currency,
            @org.jdbi.v3.core.mapper.reflect.ColumnName("status") String status,
            @org.jdbi.v3.core.mapper.reflect.ColumnName("mews_id") String mewsId,
            @org.jdbi.v3.core.mapper.reflect.ColumnName("attempts") int attempts,
            @org.jdbi.v3.core.mapper.reflect.ColumnName("created_at") java.time.Instant createdAt) {
    }
}
