package com.bliss.b2b.persistence;

import com.bliss.b2b.domain.Booking;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
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
}
