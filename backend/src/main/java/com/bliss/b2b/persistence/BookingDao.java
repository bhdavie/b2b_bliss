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
                total_amount_cents, appointment_date, cancellation_policy,
                customer_name_hint, customer_email_hint, status
            ) VALUES (
                :merchantId, :bookingToken, :serviceName, :serviceDescription,
                :totalAmountCents, :appointmentDate, :cancellationPolicy,
                :customerNameHint, :customerEmailHint, 'sent'
            )
            """)
    void insert(
            @Bind("merchantId") UUID merchantId,
            @Bind("bookingToken") String bookingToken,
            @Bind("serviceName") String serviceName,
            @Bind("serviceDescription") String serviceDescription,
            @Bind("totalAmountCents") long totalAmountCents,
            @Bind("appointmentDate") LocalDate appointmentDate,
            @Bind("cancellationPolicy") String cancellationPolicy,
            @Bind("customerNameHint") String customerNameHint,
            @Bind("customerEmailHint") String customerEmailHint
    );

    @SqlQuery("SELECT * FROM bookings WHERE booking_token = :bookingToken")
    Optional<Booking> findByToken(@Bind("bookingToken") String bookingToken);

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
}
