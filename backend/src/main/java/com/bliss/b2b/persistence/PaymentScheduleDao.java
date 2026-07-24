package com.bliss.b2b.persistence;

import com.bliss.b2b.domain.PaymentScheduleEntry;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.jdbi.v3.sqlobject.config.RegisterRowMapper;
import org.jdbi.v3.sqlobject.customizer.Bind;
import org.jdbi.v3.sqlobject.statement.SqlQuery;
import org.jdbi.v3.sqlobject.statement.SqlUpdate;

@RegisterRowMapper(PaymentScheduleRowMapper.class)
public interface PaymentScheduleDao {

    @SqlQuery("""
            SELECT * FROM payment_schedule
            WHERE payment_plan_id = :paymentPlanId
            ORDER BY sequence ASC
            """)
    List<PaymentScheduleEntry> listForPlan(@Bind("paymentPlanId") UUID paymentPlanId);

    @SqlUpdate("""
            INSERT INTO payment_schedule (
                payment_plan_id, sequence, due_date, amount_cents, status, kind
            ) VALUES (
                :paymentPlanId, :sequence, :dueDate, :amountCents, :status, :kind
            )
            """)
    void insert(
            @Bind("paymentPlanId") UUID paymentPlanId,
            @Bind("sequence") int sequence,
            @Bind("dueDate") LocalDate dueDate,
            @Bind("amountCents") long amountCents,
            @Bind("status") String status,
            @Bind("kind") String kind
    );

    @SqlUpdate("""
            UPDATE payment_schedule
            SET status = :status,
                stripe_payment_intent_id = :paymentIntentId,
                attempted_at = :attemptedAt
            WHERE payment_plan_id = :paymentPlanId AND sequence = :sequence
            """)
    int recordAttempt(
            @Bind("paymentPlanId") UUID paymentPlanId,
            @Bind("sequence") int sequence,
            @Bind("status") String status,
            @Bind("paymentIntentId") String paymentIntentId,
            @Bind("attemptedAt") Instant attemptedAt
    );

    @SqlQuery("""
            SELECT * FROM payment_schedule
            WHERE payment_plan_id = :paymentPlanId
              AND status = 'scheduled'
            ORDER BY sequence ASC
            LIMIT 1
            """)
    Optional<PaymentScheduleEntry> findNextScheduled(@Bind("paymentPlanId") UUID paymentPlanId);

    @SqlUpdate("""
            UPDATE payment_schedule
            SET status = :status,
                last_error = :lastError,
                retry_count = retry_count + :retryDelta,
                attempted_at = :attemptedAt
            WHERE id = :id
            """)
    int updateStatusWithError(
            @Bind("id") UUID id,
            @Bind("status") String status,
            @Bind("lastError") String lastError,
            @Bind("retryDelta") int retryDelta,
            @Bind("attemptedAt") Instant attemptedAt
    );

    @SqlUpdate("""
            UPDATE payment_schedule
            SET status = 'paid',
                stripe_payment_intent_id = :paymentIntentId,
                attempted_at = :now,
                paid_at = :now
            WHERE id = :id
            """)
    int markPaidNow(
            @Bind("id") UUID id,
            @Bind("paymentIntentId") String paymentIntentId,
            @Bind("now") Instant now
    );

    /**
     * Mews-rail equivalent of {@link #markPaidNow}: marks the row paid and
     * records the Mews {@code PaymentId} in its own column, leaving the
     * stripe-named column null. Used when a Mews charge settles to Charged.
     */
    @SqlUpdate("""
            UPDATE payment_schedule
            SET status = 'paid',
                mews_payment_id = :mewsPaymentId,
                attempted_at = :now,
                paid_at = :now
            WHERE id = :id
            """)
    int markPaidMews(
            @Bind("id") UUID id,
            @Bind("mewsPaymentId") String mewsPaymentId,
            @Bind("now") Instant now
    );

    /**
     * Records a Mews charge that the PMS accepted but has not yet settled
     * (Pending/Verifying, or a state we could not read back). The row moves to
     * {@code processing} with the Mews {@code PaymentId} stored; it is
     * deliberately not marked paid and its retry count is untouched. Because
     * {@code processing} is excluded from the due-charge selection, the row is
     * never re-charged while in flight; a later reconciliation pass settles it.
     */
    @SqlUpdate("""
            UPDATE payment_schedule
            SET status = 'processing',
                mews_payment_id = :mewsPaymentId,
                last_error = :note,
                attempted_at = :attemptedAt
            WHERE id = :id
            """)
    int recordMewsProcessing(
            @Bind("id") UUID id,
            @Bind("mewsPaymentId") String mewsPaymentId,
            @Bind("note") String note,
            @Bind("attemptedAt") Instant attemptedAt
    );

    /**
     * Cancel every not-yet-terminal row for a plan so no further charges fire.
     * Paid rows are left untouched (they stay part of the paid history).
     */
    @SqlUpdate("""
            UPDATE payment_schedule
            SET status = 'canceled'
            WHERE payment_plan_id = :paymentPlanId
              AND status IN ('scheduled', 'processing', 'failed', 'retrying')
            """)
    int cancelRemaining(@Bind("paymentPlanId") UUID paymentPlanId);
}
