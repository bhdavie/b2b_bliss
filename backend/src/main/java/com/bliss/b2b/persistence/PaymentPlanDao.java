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

    // Manager refund override: records the refund as state on the plan. Does not
    // change plan status (refund is independent of cancel) and is not gated by
    // policy — the merchant is overriding the default rules.
    @SqlUpdate("""
            UPDATE payment_plans
            SET refunded_at = :refundedAt,
                refund_amount_cents = :amountCents
            WHERE id = :id
            """)
    int markRefunded(
            @Bind("id") UUID id,
            @Bind("refundedAt") java.time.Instant refundedAt,
            @Bind("amountCents") long amountCents
    );

    @SqlQuery("""
            SELECT * FROM payment_plans
            WHERE booking_id = :bookingId
              AND status IN ('active', 'completed')
            LIMIT 1
            """)
    Optional<PaymentPlan> findActiveForBooking(@Bind("bookingId") UUID bookingId);

    // Latest plan for a booking regardless of status, so the read-only portal
    // view still resolves a cancelled/defaulted plan (the guest and the merchant
    // detail page need to see the cancelled state, not a "not found").
    @SqlQuery("""
            SELECT * FROM payment_plans
            WHERE booking_id = :bookingId
            ORDER BY created_at DESC
            LIMIT 1
            """)
    Optional<PaymentPlan> findLatestForBooking(@Bind("bookingId") UUID bookingId);

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
                pp.refunded_at AS refundedAt,
                pp.refund_amount_cents AS refundAmountCents,
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

    /**
     * Raw schedule rows (due date + amount) for a set of plans, so the account
     * list can run the same as-of-today PlanProgress derivation the portal uses.
     */
    @SqlQuery("""
            SELECT payment_plan_id AS paymentPlanId,
                   due_date AS dueDate,
                   amount_cents AS amountCents
            FROM payment_schedule
            WHERE payment_plan_id IN (<planIds>)
            ORDER BY payment_plan_id, sequence
            """)
    @RegisterConstructorMapper(ScheduleRow.class)
    List<ScheduleRow> scheduleRowsForPlans(@BindList("planIds") List<UUID> planIds);

    record ScheduleRow(
            UUID paymentPlanId,
            LocalDate dueDate,
            long amountCents
    ) {}

    /**
     * Per-booking inputs for the merchant Bookings table's derived status. One
     * row per booking for the merchant, joined to its LATEST plan (any status)
     * and that plan's schedule, with paid / overdue counts resolved as-of the
     * given date. Plan columns are null when a booking has no plan yet.
     */
    @SqlQuery("""
            SELECT b.id                AS bookingId,
                   b.status            AS bookingStatus,
                   b.appointment_date  AS checkInDate,
                   latest.plan_status  AS planStatus,
                   latest.num_payments AS numPayments,
                   latest.paid_count   AS paidCount,
                   latest.overdue_count AS overdueCount
            FROM bookings b
            LEFT JOIN LATERAL (
                SELECT pp.status AS plan_status,
                       pp.num_payments AS num_payments,
                       (SELECT count(*) FROM payment_schedule ps
                          WHERE ps.payment_plan_id = pp.id AND ps.status = 'paid') AS paid_count,
                       (SELECT count(*) FROM payment_schedule ps
                          WHERE ps.payment_plan_id = pp.id
                            AND ps.status <> 'paid' AND ps.due_date < :today) AS overdue_count
                FROM payment_plans pp
                WHERE pp.booking_id = b.id
                ORDER BY pp.created_at DESC
                LIMIT 1
            ) latest ON TRUE
            WHERE b.merchant_id = :merchantId
            """)
    @RegisterConstructorMapper(BookingStatusInputs.class)
    List<BookingStatusInputs> statusInputsForMerchant(
            @Bind("merchantId") UUID merchantId,
            @Bind("today") LocalDate today
    );

    record BookingStatusInputs(
            UUID bookingId,
            String bookingStatus,
            LocalDate checkInDate,
            String planStatus,      // null when the booking has no plan
            Integer numPayments,    // null when no plan
            Long paidCount,         // null when no plan
            Long overdueCount       // null when no plan
    ) {}

    record PaymentPlanListItem(
            UUID id,
            UUID bookingId,
            long totalAmountCents,
            int numPayments,
            String frequency,
            long depositAmountCents,
            long processingFeeCents,
            String status,
            Instant refundedAt,
            Long refundAmountCents,
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
