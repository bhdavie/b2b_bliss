package com.bliss.b2b.persistence;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.jdbi.v3.core.mapper.reflect.ColumnName;
import org.jdbi.v3.sqlobject.config.RegisterConstructorMapper;
import org.jdbi.v3.sqlobject.customizer.Bind;
import org.jdbi.v3.sqlobject.statement.SqlQuery;
import org.jdbi.v3.sqlobject.statement.SqlUpdate;

/** Hold mode releases (V41 payout_releases) and the property's Stripe payouts (V41 payouts). */
public interface PayoutReleaseDao {

    /** A paid payment on a hold-mode booking that has no release row yet. */
    record Unscheduled(
            @ColumnName("schedule_id") UUID scheduleId,
            @ColumnName("plan_id") UUID planId,
            @ColumnName("booking_id") UUID bookingId,
            @ColumnName("merchant_id") UUID merchantId,
            @ColumnName("amount_cents") long amountCents,
            @ColumnName("paid_at") Instant paidAt) {
    }

    @SqlQuery("""
            SELECT ps.id AS schedule_id, pp.id AS plan_id, b.id AS booking_id, b.merchant_id,
                   ps.amount_cents, COALESCE(ps.paid_at, ps.updated_at) AS paid_at
            FROM payment_schedule ps
            JOIN payment_plans pp ON pp.id = ps.payment_plan_id
            JOIN bookings b ON b.id = pp.booking_id
            WHERE b.payout_mode = 'hold'
              AND ps.status = 'paid'
              AND pp.status <> 'canceled'
              AND NOT EXISTS (SELECT 1 FROM payout_releases r
                              WHERE r.booking_id = b.id AND r.step = 'payment:' || ps.id)
            ORDER BY b.merchant_id, ps.paid_at
            """)
    @RegisterConstructorMapper(Unscheduled.class)
    List<Unscheduled> unscheduledPayments();

    /** Inserts a release; returns 0 when the step already has one. */
    @SqlUpdate("""
            INSERT INTO payout_releases (booking_id, payment_plan_id, step, release_at, amount_minor, fee_minor,
                                         currency)
            VALUES (:bookingId, :planId, :step, :releaseAt, :amount, :fee, :currency)
            ON CONFLICT (booking_id, step) DO NOTHING
            """)
    int insert(@Bind("bookingId") UUID bookingId, @Bind("planId") UUID planId, @Bind("step") String step,
            @Bind("releaseAt") Instant releaseAt, @Bind("amount") long amount, @Bind("fee") long fee,
            @Bind("currency") String currency);

    record Release(
            @ColumnName("id") UUID id,
            @ColumnName("booking_id") UUID bookingId,
            @ColumnName("payment_plan_id") UUID planId,
            @ColumnName("step") String step,
            @ColumnName("release_at") Instant releaseAt,
            @ColumnName("amount_minor") long amountMinor,
            @ColumnName("fee_minor") long feeMinor,
            @ColumnName("reversed_minor") long reversedMinor,
            @ColumnName("currency") String currency,
            @ColumnName("status") String status,
            @ColumnName("stripe_transfer_id") String stripeTransferId,
            @ColumnName("last_error") String lastError,
            @ColumnName("released_at") Instant releasedAt) {

        /** What the property still has from this release. */
        public long heldByPropertyMinor() {
            return "released".equals(status) || "reversed".equals(status) ? amountMinor - reversedMinor : 0L;
        }
    }

    /** Releases whose point has passed. A fee debit is not a release and is never picked up here. */
    @SqlQuery("""
            SELECT * FROM payout_releases r
            WHERE r.status = 'scheduled' AND r.release_at <= :now AND r.step <> 'fee_debit'
              -- A payment with an open card dispute stays held until it closes (V45).
              AND NOT EXISTS (SELECT 1 FROM plan_disputes d
                              WHERE r.step = 'payment:' || d.payment_schedule_id
                                AND d.status NOT IN ('won', 'lost', 'warning_closed'))
            -- Ties broken by creation, so releases due together go out in payment order.
            ORDER BY r.release_at, r.created_at
            """)
    @RegisterConstructorMapper(Release.class)
    List<Release> due(@Bind("now") Instant now);

    @SqlQuery("SELECT * FROM payout_releases WHERE id = :id")
    @RegisterConstructorMapper(Release.class)
    Optional<Release> find(@Bind("id") UUID id);

    @SqlQuery("SELECT * FROM payout_releases WHERE booking_id = :bookingId ORDER BY release_at, created_at")
    @RegisterConstructorMapper(Release.class)
    List<Release> forBooking(@Bind("bookingId") UUID bookingId);

    @SqlQuery("""
            SELECT r.* FROM payout_releases r JOIN bookings b ON b.id = r.booking_id
            WHERE b.merchant_id = :merchantId
            ORDER BY r.release_at DESC
            LIMIT 200
            """)
    @RegisterConstructorMapper(Release.class)
    List<Release> forMerchant(@Bind("merchantId") UUID merchantId);

    @SqlUpdate("""
            UPDATE payout_releases SET status = 'released', stripe_transfer_id = :transferId, released_at = :at,
                                       last_error = NULL
            WHERE id = :id AND status = 'scheduled'
            """)
    int markReleased(@Bind("id") UUID id, @Bind("transferId") String transferId, @Bind("at") Instant at);

    @SqlUpdate("UPDATE payout_releases SET attempts = attempts + 1, last_error = :error WHERE id = :id")
    int recordFailure(@Bind("id") UUID id, @Bind("error") String error);

    /** Stops every release of a booking still waiting for its point. */
    @SqlUpdate("UPDATE payout_releases SET status = 'canceled' WHERE booking_id = :bookingId AND status = 'scheduled'")
    int cancelScheduled(@Bind("bookingId") UUID bookingId);

    @SqlUpdate("""
            UPDATE payout_releases
            SET reversed_minor = reversed_minor + :amount,
                status = CASE WHEN reversed_minor + :amount >= amount_minor THEN 'reversed' ELSE status END
            WHERE id = :id
            """)
    int recordReversal(@Bind("id") UUID id, @Bind("amount") long amount);

    // --- Payouts ---------------------------------------------------------------

    @SqlUpdate("""
            INSERT INTO payouts (merchant_id, stripe_payout_id, amount_minor, currency, status, arrival_date,
                                 failure_message)
            VALUES (:merchantId, :payoutId, :amount, :currency, :status, :arrival, :failure)
            ON CONFLICT (stripe_payout_id) DO UPDATE
            SET status = EXCLUDED.status, amount_minor = EXCLUDED.amount_minor,
                arrival_date = EXCLUDED.arrival_date, failure_message = EXCLUDED.failure_message,
                updated_at = NOW()
            """)
    int upsertPayout(@Bind("merchantId") UUID merchantId, @Bind("payoutId") String payoutId,
            @Bind("amount") long amount, @Bind("currency") String currency, @Bind("status") String status,
            @Bind("arrival") java.time.LocalDate arrival, @Bind("failure") String failure);

    record Payout(
            @ColumnName("stripe_payout_id") String stripePayoutId,
            @ColumnName("amount_minor") long amountMinor,
            @ColumnName("currency") String currency,
            @ColumnName("status") String status,
            @ColumnName("arrival_date") java.time.LocalDate arrivalDate,
            @ColumnName("failure_message") String failureMessage) {
    }

    @SqlQuery("SELECT * FROM payouts WHERE merchant_id = :merchantId ORDER BY arrival_date DESC NULLS FIRST LIMIT 100")
    @RegisterConstructorMapper(Payout.class)
    List<Payout> payoutsForMerchant(@Bind("merchantId") UUID merchantId);
}
