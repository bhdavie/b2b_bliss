package com.bliss.b2b.persistence;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.jdbi.v3.sqlobject.config.RegisterConstructorMapper;
import org.jdbi.v3.sqlobject.customizer.Bind;
import org.jdbi.v3.sqlobject.statement.SqlQuery;
import org.jdbi.v3.sqlobject.statement.SqlUpdate;
import org.jdbi.v3.core.mapper.reflect.ColumnName;

/**
 * Storage for linking booking-engine reservations to Bliss plans (V34): the
 * property's Bliss rates and polling mark, the per-reservation link rows, and
 * the flags raised for the property.
 */
public interface MewsLinkingDao {

    // --- Connection -----------------------------------------------------------

    /**
     * Stores the property's Bliss rates and the deposit the pop-up shows for
     * each (basis points, display only). Either rate may be null (one schedule only).
     * Sets the polling mark to {@code linkFromUtc} only when none is set, so
     * re-saving the setup never re-reads history or skips ahead.
     */
    @SqlUpdate("""
            UPDATE merchant_mews_connections
            SET service_id = :serviceId,
                bliss_monthly_rate_id = :monthlyRateId,
                bliss_biweekly_rate_id = :biweeklyRateId,
                bliss_monthly_deposit_bps = :monthlyDepositBps,
                bliss_biweekly_deposit_bps = :biweeklyDepositBps,
                time_zone = :timeZone,
                linked_through_utc = COALESCE(linked_through_utc, :linkFromUtc)
            WHERE merchant_id = :merchantId
            """)
    int updateBlissRates(
            @Bind("merchantId") UUID merchantId,
            @Bind("serviceId") String serviceId,
            @Bind("monthlyRateId") String monthlyRateId,
            @Bind("biweeklyRateId") String biweeklyRateId,
            @Bind("monthlyDepositBps") Integer monthlyDepositBps,
            @Bind("biweeklyDepositBps") Integer biweeklyDepositBps,
            @Bind("timeZone") String timeZone,
            @Bind("linkFromUtc") Instant linkFromUtc);

    /** Merchants whose Mews connection has a service and at least one Bliss rate. */
    @SqlQuery("""
            SELECT merchant_id FROM merchant_mews_connections
            WHERE validated_at IS NOT NULL
              AND service_id IS NOT NULL
              AND (bliss_monthly_rate_id IS NOT NULL OR bliss_biweekly_rate_id IS NOT NULL)
            ORDER BY merchant_id
            """)
    List<UUID> findLinkingMerchants();

    /** Moves the polling mark forward. Never backwards. */
    @SqlUpdate("""
            UPDATE merchant_mews_connections
            SET linked_through_utc = GREATEST(COALESCE(linked_through_utc, :through), :through)
            WHERE merchant_id = :merchantId
            """)
    int advanceLinkedThrough(@Bind("merchantId") UUID merchantId, @Bind("through") Instant through);

    // --- Link rows ------------------------------------------------------------

    /** Records a Bliss-rate reservation as seen. No-op if it already has a row. */
    @SqlUpdate("""
            INSERT INTO mews_reservation_links (merchant_id, reservation_id)
            VALUES (:merchantId, :reservationId)
            ON CONFLICT (merchant_id, reservation_id) DO NOTHING
            """)
    int insertPendingLink(@Bind("merchantId") UUID merchantId, @Bind("reservationId") String reservationId);

    @SqlQuery("""
            SELECT id, merchant_id, reservation_id, status, booking_id, attempts, last_error, first_seen_at
            FROM mews_reservation_links
            WHERE merchant_id = :merchantId AND status = 'pending'
            ORDER BY first_seen_at
            """)
    @RegisterConstructorMapper(LinkRow.class)
    List<LinkRow> findPendingLinks(@Bind("merchantId") UUID merchantId);

    @SqlQuery("""
            SELECT id, merchant_id, reservation_id, status, booking_id, attempts, last_error, first_seen_at
            FROM mews_reservation_links
            WHERE merchant_id = :merchantId AND reservation_id = :reservationId
            """)
    @RegisterConstructorMapper(LinkRow.class)
    Optional<LinkRow> findLink(@Bind("merchantId") UUID merchantId, @Bind("reservationId") String reservationId);

    /** Counts an attempt that could not link yet, keeping why. */
    @SqlUpdate("""
            UPDATE mews_reservation_links
            SET attempts = attempts + 1, last_error = :error, last_attempt_at = :at
            WHERE id = :id AND status = 'pending'
            """)
    int recordAttempt(@Bind("id") UUID id, @Bind("error") String error, @Bind("at") Instant at);

    /**
     * Marks a pending link linked to the booking just built. Returns 0 when the
     * row was no longer pending, so the caller's transaction rolls back rather
     * than build a second plan for one reservation.
     */
    @SqlUpdate("""
            UPDATE mews_reservation_links
            SET status = 'linked', booking_id = :bookingId, last_error = NULL,
                attempts = attempts + 1, last_attempt_at = :at
            WHERE id = :id AND status = 'pending'
            """)
    int markLinked(@Bind("id") UUID id, @Bind("bookingId") UUID bookingId, @Bind("at") Instant at);

    @SqlUpdate("""
            UPDATE mews_reservation_links
            SET status = 'flagged', last_error = :error,
                attempts = attempts + 1, last_attempt_at = :at
            WHERE id = :id AND status = 'pending'
            """)
    int markFlagged(@Bind("id") UUID id, @Bind("error") String error, @Bind("at") Instant at);

    /** Drops a pending link whose reservation was abandoned before it was paid. */
    @SqlUpdate("DELETE FROM mews_reservation_links WHERE id = :id AND status = 'pending'")
    int deletePending(@Bind("id") UUID id);

    record LinkRow(
            @ColumnName("id") UUID id,
            @ColumnName("merchant_id") UUID merchantId,
            @ColumnName("reservation_id") String reservationId,
            @ColumnName("status") String status,
            @ColumnName("booking_id") UUID bookingId,
            @ColumnName("attempts") int attempts,
            @ColumnName("last_error") String lastError,
            @ColumnName("first_seen_at") Instant firstSeenAt) {
    }

    // --- Linked bookings --------------------------------------------------------

    /**
     * The linked booking for a reservation, with the stay as it was linked, for
     * change detection. Empty when Bliss has no booking on this reservation.
     */
    @SqlQuery("""
            SELECT b.id AS booking_id, b.status AS booking_status,
                   b.mews_start_utc AS start_utc, b.mews_end_utc AS end_utc
            FROM bookings b
            WHERE b.merchant_id = :merchantId AND b.mews_reservation_id = :reservationId
            """)
    @RegisterConstructorMapper(LinkedBooking.class)
    Optional<LinkedBooking> findLinkedBooking(
            @Bind("merchantId") UUID merchantId, @Bind("reservationId") String reservationId);

    record LinkedBooking(
            @ColumnName("booking_id") UUID bookingId,
            @ColumnName("booking_status") String bookingStatus,
            @ColumnName("start_utc") Instant startUtc,
            @ColumnName("end_utc") Instant endUtc) {
    }

    /**
     * Records the reservation behind a booking built from the booking engine,
     * with the stay window it was linked at. The reservation was confirmed in
     * Mews before Bliss saw it, so it is marked confirmed here and the
     * background confirm never picks it up.
     */
    @SqlUpdate("""
            UPDATE bookings
            SET mews_reservation_id = :reservationId,
                mews_resource_category_id = :categoryId,
                mews_rate_id = :rateId,
                mews_start_utc = :startUtc,
                mews_end_utc = :endUtc,
                mews_confirmed_at = :at
            WHERE id = :id AND mews_reservation_id IS NULL
            """)
    int attachReservation(
            @Bind("id") UUID bookingId,
            @Bind("reservationId") String reservationId,
            @Bind("categoryId") String categoryId,
            @Bind("rateId") String rateId,
            @Bind("startUtc") Instant startUtc,
            @Bind("endUtc") Instant endUtc,
            @Bind("at") Instant at);

    // --- Flags ------------------------------------------------------------------

    /**
     * Raises a flag. Returns 1 when it is new and 0 when this reservation
     * already has a flag of this kind, so the caller emails the property once.
     */
    @SqlUpdate("""
            INSERT INTO mews_flags (merchant_id, reservation_id, booking_id, kind, detail)
            VALUES (:merchantId, :reservationId, :bookingId, :kind, :detail)
            ON CONFLICT (merchant_id, reservation_id, kind) DO NOTHING
            """)
    int insertFlag(
            @Bind("merchantId") UUID merchantId,
            @Bind("reservationId") String reservationId,
            @Bind("bookingId") UUID bookingId,
            @Bind("kind") String kind,
            @Bind("detail") String detail);

    @SqlUpdate("""
            UPDATE mews_flags SET notified_at = :at
            WHERE merchant_id = :merchantId AND reservation_id = :reservationId AND kind = :kind
            """)
    int markFlagNotified(
            @Bind("merchantId") UUID merchantId,
            @Bind("reservationId") String reservationId,
            @Bind("kind") String kind,
            @Bind("at") Instant at);
}
