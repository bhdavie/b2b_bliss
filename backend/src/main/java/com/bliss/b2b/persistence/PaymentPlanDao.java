package com.bliss.b2b.persistence;

import com.bliss.b2b.domain.PaymentPlan;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.jdbi.v3.sqlobject.config.RegisterConstructorMapper;
import org.jdbi.v3.sqlobject.config.RegisterRowMapper;
import org.jdbi.v3.sqlobject.customizer.Bind;
import org.jdbi.v3.sqlobject.customizer.BindList;
import org.jdbi.v3.sqlobject.statement.SqlQuery;
import org.jdbi.v3.sqlobject.statement.SqlUpdate;

@RegisterRowMapper(PaymentPlanRowMapper.class)
public interface PaymentPlanDao {

    @SqlQuery("SELECT * FROM payment_plans WHERE id = :id")
    Optional<PaymentPlan> findById(@Bind("id") UUID id);

    @SqlQuery("""
            SELECT pp.* FROM payment_plans pp
            JOIN bookings b ON b.id = pp.booking_id
            WHERE pp.id = :id AND b.merchant_id = :merchantId
            """)
    Optional<PaymentPlan> findByIdForMerchant(
            @Bind("id") UUID id,
            @Bind("merchantId") UUID merchantId
    );

    @SqlQuery("""
            SELECT pp.* FROM payment_plans pp
            JOIN bookings b ON b.id = pp.booking_id
            WHERE b.merchant_id = :merchantId
              AND pp.status IN (
                'payment_failed_in_retry',
                'payment_failed_exhausted',
                'defaulted',
                'balance_due'
              )
            ORDER BY pp.updated_at DESC
            """)
    java.util.List<PaymentPlan> findAttentionForMerchant(
            @Bind("merchantId") UUID merchantId
    );

    @SqlUpdate("""
            UPDATE payment_plans
            SET status = :status
            WHERE id = :id
            """)
    int updateStatus(@Bind("id") UUID id, @Bind("status") String status);

    @SqlUpdate("""
            UPDATE payment_plans
            SET status = 'canceled',
                canceled_at = :canceledAt,
                canceled_reason = :reason
            WHERE id = :id
            """)
    int markCanceled(
            @Bind("id") UUID id,
            @Bind("canceledAt") java.time.Instant canceledAt,
            @Bind("reason") String reason
    );

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
                deposit_amount_cents, processing_fee_cents
            ) VALUES (
                :bookingId, :customerId, :customerCardId, :totalAmountCents,
                :numPayments, :frequency, :startDate, :endDate, 'active',
                :depositAmountCents, :processingFeeCents
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
            @Bind("depositAmountCents") long depositAmountCents,
            @Bind("processingFeeCents") long processingFeeCents
    );

    /**
     * All plans tied to the given customer email, joined with the booking
     * and merchant rows the /account index needs to render cards. Joined
     * through email (not memoized customer_id) so the query keeps working
     * if email-uniqueness is ever relaxed.
     */
    @SqlQuery("""
            SELECT
                pp.id AS id,
                pp.booking_id AS bookingId,
                pp.total_amount_cents AS totalAmountCents,
                pp.num_payments AS numPayments,
                pp.frequency AS frequency,
                pp.deposit_amount_cents AS depositAmountCents,
                pp.processing_fee_cents AS processingFeeCents,
                pp.status AS status,
                pp.created_at AS createdAt,
                m.slug AS merchantSlug,
                m.business_name AS merchantBusinessName,
                b.booking_token AS bookingToken,
                b.service_name AS serviceName,
                b.appointment_date AS appointmentDate,
                b.checkout_date AS checkoutDate,
                b.original_total_cents AS originalTotalCents
            FROM payment_plans pp
            JOIN bookings  b ON b.id = pp.booking_id
            JOIN merchants m ON m.id = b.merchant_id
            JOIN customers c ON c.id = pp.customer_id
            WHERE c.email = :email
            ORDER BY pp.created_at DESC
            """)
    @RegisterConstructorMapper(PaymentPlanListItem.class)
    List<PaymentPlanListItem> findAllForCustomerEmail(@Bind("email") String email);

    /**
     * Per-plan summary used by the /account index: how many rows are paid,
     * how many are still scheduled, and the next scheduled charge's date +
     * amount. One pass over payment_schedule for every plan in {@code planIds}.
     */
    @SqlQuery("""
            SELECT
                payment_plan_id AS paymentPlanId,
                COUNT(*) FILTER (WHERE status='paid')::int AS paidCount,
                COUNT(*) FILTER (WHERE status='scheduled')::int AS scheduledCount,
                COALESCE(SUM(amount_cents) FILTER (WHERE status='paid'), 0) AS paidCents,
                MIN(CASE WHEN status='scheduled' THEN due_date END) AS nextDueDate,
                MIN(CASE WHEN status='scheduled' THEN amount_cents END) AS nextDueAmountCents
            FROM payment_schedule
            WHERE payment_plan_id IN (<planIds>)
            GROUP BY payment_plan_id
            """)
    @RegisterConstructorMapper(PlanScheduleSummary.class)
    List<PlanScheduleSummary> summarizeSchedules(@BindList("planIds") List<UUID> planIds);

    record PaymentPlanListItem(
            UUID id,
            UUID bookingId,
            long totalAmountCents,
            int numPayments,
            String frequency,
            long depositAmountCents,
            long processingFeeCents,
            String status,
            Instant createdAt,
            String merchantSlug,
            String merchantBusinessName,
            String bookingToken,
            String serviceName,
            LocalDate appointmentDate,
            LocalDate checkoutDate,
            Long originalTotalCents
    ) {}

    record PlanScheduleSummary(
            UUID paymentPlanId,
            int paidCount,
            int scheduledCount,
            long paidCents,
            LocalDate nextDueDate,
            Long nextDueAmountCents
    ) {}
}
