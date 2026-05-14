package com.bliss.b2b.persistence;

import com.bliss.b2b.domain.PaymentScheduleEntry;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
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
}
