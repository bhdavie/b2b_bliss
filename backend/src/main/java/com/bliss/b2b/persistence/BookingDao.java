package com.bliss.b2b.persistence;

import com.bliss.b2b.domain.Booking;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.jdbi.v3.core.mapper.reflect.ColumnName;
import org.jdbi.v3.sqlobject.config.RegisterConstructorMapper;
import org.jdbi.v3.sqlobject.config.RegisterRowMapper;
import org.jdbi.v3.sqlobject.customizer.Bind;
import org.jdbi.v3.sqlobject.statement.SqlQuery;
import org.jdbi.v3.sqlobject.statement.SqlUpdate;

@RegisterRowMapper(BookingRowMapper.class)
public interface BookingDao {

    @SqlUpdate("""
            INSERT INTO bookings (
                merchant_id, booking_token, service_name, service_description,
                total_amount_cents, appointment_date, checkout_date,
                cancellation_policy, customer_name_hint, customer_email_hint,
                customer_phone_hint, status, booking_source
            ) VALUES (
                :merchantId, :bookingToken, :serviceName, :serviceDescription,
                :totalAmountCents, :appointmentDate, :checkoutDate,
                :cancellationPolicy, :customerNameHint, :customerEmailHint,
                :customerPhoneHint, 'sent', :bookingSource
            )
            """)
    void insert(
            @Bind("merchantId") UUID merchantId,
            @Bind("bookingToken") String bookingToken,
            @Bind("serviceName") String serviceName,
            @Bind("serviceDescription") String serviceDescription,
            @Bind("totalAmountCents") long totalAmountCents,
            @Bind("appointmentDate") LocalDate appointmentDate,
            @Bind("checkoutDate") LocalDate checkoutDate,
            @Bind("cancellationPolicy") String cancellationPolicy,
            @Bind("customerNameHint") String customerNameHint,
            @Bind("customerEmailHint") String customerEmailHint,
            @Bind("customerPhoneHint") String customerPhoneHint,
            @Bind("bookingSource") String bookingSource
    );

    @SqlQuery("SELECT * FROM bookings WHERE booking_token = :bookingToken")
    Optional<Booking> findByToken(@Bind("bookingToken") String bookingToken);

    @SqlQuery("SELECT * FROM bookings WHERE id = :id")
    Optional<Booking> findById(@Bind("id") UUID id);

    @SqlQuery("""
            SELECT b.* FROM bookings b
            JOIN merchants m ON m.id = b.merchant_id
            WHERE b.booking_token = :bookingToken
              AND m.slug = :slug
            """)
    Optional<Booking> findBySlugAndToken(
            @Bind("slug") String slug,
            @Bind("bookingToken") String bookingToken
    );

    @SqlUpdate("""
            UPDATE bookings
            SET status = 'accepted',
                customer_id = :customerId
            WHERE id = :id AND status = 'sent'
            """)
    int markAccepted(
            @Bind("id") UUID id,
            @Bind("customerId") UUID customerId
    );

    @SqlQuery("SELECT * FROM bookings WHERE id = :id AND merchant_id = :merchantId")
    Optional<Booking> findByIdForMerchant(
            @Bind("id") UUID id,
            @Bind("merchantId") UUID merchantId
    );

    @SqlQuery("""
            SELECT * FROM bookings
            WHERE merchant_id = :merchantId
            ORDER BY created_at DESC
            LIMIT :limit OFFSET :offset
            """)
    List<Booking> listForMerchant(
            @Bind("merchantId") UUID merchantId,
            @Bind("limit") int limit,
            @Bind("offset") int offset
    );

    @SqlQuery("SELECT COUNT(*) FROM bookings WHERE merchant_id = :merchantId")
    long countForMerchant(@Bind("merchantId") UUID merchantId);

    /**
     * Applied at plan-acceptance time when the merchant's plan_rules carry a
     * non-zero discount. {@code originalTotalCents} captures the pre-discount
     * published price so the dashboard can show the savings story.
     */
    @SqlUpdate("""
            UPDATE bookings
            SET total_amount_cents = :discountedTotalCents,
                original_total_cents = :originalTotalCents
            WHERE id = :id
            """)
    int applyPlanDiscount(
            @Bind("id") UUID id,
            @Bind("discountedTotalCents") long discountedTotalCents,
            @Bind("originalTotalCents") long originalTotalCents
    );

    /** Records the Mews room, rate and adults a customer-initiated booking was priced for. */
    @SqlUpdate("""
            UPDATE bookings
            SET mews_resource_category_id = :categoryId,
                mews_rate_id = :rateId,
                adult_count = :adults
            WHERE id = :id
            """)
    int setMewsStay(
            @Bind("id") UUID id,
            @Bind("categoryId") String categoryId,
            @Bind("rateId") String rateId,
            @Bind("adults") int adults);

    /**
     * Records the Mews reservation backing this booking, only if none is
     * recorded yet. Returns 0 when another request got there first, so the
     * caller can release its own hold instead of overwriting.
     */
    @SqlUpdate("""
            UPDATE bookings
            SET mews_reservation_id = :reservationId
            WHERE id = :id AND mews_reservation_id IS NULL
            """)
    int setMewsReservationId(@Bind("id") UUID id, @Bind("reservationId") String reservationId);

    /** Forgets a released hold, only if it is still the one recorded. */
    @SqlUpdate("""
            UPDATE bookings
            SET mews_reservation_id = NULL,
                mews_confirmed_at = NULL,
                mews_confirm_attempts = 0,
                mews_confirm_error = NULL
            WHERE id = :id AND mews_reservation_id = :reservationId
            """)
    int clearMewsReservationId(@Bind("id") UUID id, @Bind("reservationId") String reservationId);

    /** Marks a booking canceled once its stay has been cancelled. */
    @SqlUpdate("UPDATE bookings SET status = 'canceled' WHERE id = :id")
    int markCanceled(@Bind("id") UUID id);

    /** Records that Mews has the booking's reservation confirmed. Idempotent. */
    @SqlUpdate("""
            UPDATE bookings
            SET mews_confirmed_at = COALESCE(mews_confirmed_at, :at),
                mews_confirm_error = NULL
            WHERE id = :id
            """)
    int markMewsConfirmed(@Bind("id") UUID id, @Bind("at") Instant at);

    /** Counts a failed background confirm and keeps its reason. Returns the new attempt count. */
    @SqlQuery("""
            UPDATE bookings
            SET mews_confirm_attempts = mews_confirm_attempts + 1,
                mews_confirm_error = :error
            WHERE id = :id
            RETURNING mews_confirm_attempts
            """)
    int recordMewsConfirmFailure(@Bind("id") UUID id, @Bind("error") String error);

    /**
     * Bookings whose first payment has been taken but whose Mews reservation
     * is not recorded as confirmed, and that have not been found cancelled in
     * Mews. The reconciliation pass works through these until Mews confirms.
     */
    @SqlQuery("""
            SELECT b.id                    AS booking_id,
                   b.merchant_id           AS merchant_id,
                   b.mews_reservation_id   AS reservation_id,
                   b.mews_confirm_attempts AS attempts
            FROM bookings b
            WHERE b.mews_reservation_id IS NOT NULL
              AND b.mews_confirmed_at IS NULL
              AND b.status <> 'canceled'
              AND b.mews_confirm_error IS DISTINCT FROM 'canceled in mews'
              AND EXISTS (
                  SELECT 1 FROM payment_plans pp
                  WHERE pp.booking_id = b.id
                    AND pp.status NOT IN ('pending_card', 'canceled'))
            ORDER BY b.merchant_id
            """)
    @RegisterConstructorMapper(UnconfirmedMewsStay.class)
    List<UnconfirmedMewsStay> findUnconfirmedMewsStays();

    record UnconfirmedMewsStay(
            @ColumnName("booking_id") UUID bookingId,
            @ColumnName("merchant_id") UUID merchantId,
            @ColumnName("reservation_id") String reservationId,
            @ColumnName("attempts") int attempts) {
    }
}
