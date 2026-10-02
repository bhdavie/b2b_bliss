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

/** Card disputes on Bliss charges (V45). */
public interface PlanDisputeDao {

    /** Statuses after which nothing more happens on a dispute. */
    String CLOSED_STATUSES = "('won', 'lost', 'warning_closed')";

    record Dispute(
            @ColumnName("id") UUID id,
            @ColumnName("stripe_dispute_id") String stripeDisputeId,
            @ColumnName("stripe_charge_id") String stripeChargeId,
            @ColumnName("stripe_payment_intent_id") String stripePaymentIntentId,
            @ColumnName("payment_plan_id") UUID planId,
            @ColumnName("payment_schedule_id") UUID scheduleId,
            @ColumnName("merchant_id") UUID merchantId,
            @ColumnName("amount_minor") long amountMinor,
            @ColumnName("currency") String currency,
            @ColumnName("reason") String reason,
            @ColumnName("status") String status,
            @ColumnName("evidence_due_by") Instant evidenceDueBy,
            @ColumnName("livemode") boolean livemode,
            @ColumnName("created_at") Instant createdAt,
            @ColumnName("closed_at") Instant closedAt) {

        public boolean open() {
            return !("won".equals(status) || "lost".equals(status) || "warning_closed".equals(status));
        }
    }

    /** Records a dispute the first time it is seen. Returns 1 when it is new, 0 when Bliss already had it. */
    @SqlUpdate("""
            INSERT INTO plan_disputes (stripe_dispute_id, stripe_charge_id, stripe_payment_intent_id, payment_plan_id,
                                       payment_schedule_id, merchant_id, amount_minor, currency, reason, status,
                                       evidence_due_by, livemode)
            -- Explicit casts: an unmatched dispute binds nulls, which Postgres can't type on its own.
            VALUES (:disputeId, :chargeId, :intentId, CAST(:planId AS uuid), CAST(:scheduleId AS uuid),
                    CAST(:merchantId AS uuid), :amount, :currency, :reason, :status,
                    CAST(:dueBy AS timestamptz), :livemode)
            ON CONFLICT (stripe_dispute_id) DO NOTHING
            """)
    int insert(@Bind("disputeId") String disputeId, @Bind("chargeId") String chargeId,
            @Bind("intentId") String intentId, @Bind("planId") UUID planId, @Bind("scheduleId") UUID scheduleId,
            @Bind("merchantId") UUID merchantId, @Bind("amount") long amount, @Bind("currency") String currency,
            @Bind("reason") String reason, @Bind("status") String status, @Bind("dueBy") Instant dueBy,
            @Bind("livemode") boolean livemode);

    /** A later event: the status, amount and deadline as Stripe now has them. */
    @SqlUpdate("""
            UPDATE plan_disputes
            SET status = :status, amount_minor = :amount, reason = :reason,
                evidence_due_by = CAST(:dueBy AS timestamptz),
                updated_at = NOW(),
                closed_at = CASE WHEN :status IN ('won', 'lost', 'warning_closed')
                                 THEN COALESCE(closed_at, NOW()) ELSE NULL END
            WHERE stripe_dispute_id = :disputeId
            """)
    int update(@Bind("disputeId") String disputeId, @Bind("status") String status, @Bind("amount") long amount,
            @Bind("reason") String reason, @Bind("dueBy") Instant dueBy);

    @SqlQuery("SELECT * FROM plan_disputes WHERE stripe_dispute_id = :disputeId")
    @RegisterConstructorMapper(Dispute.class)
    Optional<Dispute> find(@Bind("disputeId") String disputeId);

    @SqlQuery("SELECT * FROM plan_disputes WHERE payment_plan_id = :planId ORDER BY created_at")
    @RegisterConstructorMapper(Dispute.class)
    List<Dispute> forPlan(@Bind("planId") UUID planId);

    @SqlQuery("SELECT * FROM plan_disputes WHERE merchant_id = :merchantId ORDER BY created_at DESC")
    @RegisterConstructorMapper(Dispute.class)
    List<Dispute> forMerchant(@Bind("merchantId") UUID merchantId);
}
