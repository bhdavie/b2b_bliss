package com.bliss.b2b.persistence;

import com.bliss.b2b.domain.PaymentPlan;
import java.time.LocalDate;
import java.util.Optional;
import java.util.UUID;
import org.jdbi.v3.sqlobject.config.RegisterRowMapper;
import org.jdbi.v3.sqlobject.customizer.Bind;
import org.jdbi.v3.sqlobject.statement.SqlQuery;
import org.jdbi.v3.sqlobject.statement.SqlUpdate;

@RegisterRowMapper(PaymentPlanRowMapper.class)
public interface PaymentPlanDao {

    @SqlQuery("SELECT * FROM payment_plans WHERE id = :id")
    Optional<PaymentPlan> findById(@Bind("id") UUID id);

    @SqlQuery("""
            SELECT * FROM payment_plans
            WHERE booking_id = :bookingId
              AND status IN ('active', 'completed')
            LIMIT 1
            """)
    Optional<PaymentPlan> findActiveForBooking(@Bind("bookingId") UUID bookingId);

    @SqlUpdate("""
            INSERT INTO payment_plans (
                booking_id, customer_id, customer_card_id, total_amount_cents,
                num_payments, frequency, start_date, end_date, status,
                deposit_amount_cents
            ) VALUES (
                :bookingId, :customerId, :customerCardId, :totalAmountCents,
                :numPayments, :frequency, :startDate, :endDate, 'active',
                :depositAmountCents
            )
            """)
    void insert(
            @Bind("bookingId") UUID bookingId,
            @Bind("customerId") UUID customerId,
            @Bind("customerCardId") UUID customerCardId,
            @Bind("totalAmountCents") long totalAmountCents,
            @Bind("numPayments") int numPayments,
            @Bind("frequency") String frequency,
            @Bind("startDate") LocalDate startDate,
            @Bind("endDate") LocalDate endDate,
            @Bind("depositAmountCents") long depositAmountCents
    );
}
