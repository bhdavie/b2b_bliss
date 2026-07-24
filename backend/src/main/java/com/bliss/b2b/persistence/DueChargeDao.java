package com.bliss.b2b.persistence;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.jdbi.v3.core.mapper.reflect.ColumnName;
import org.jdbi.v3.sqlobject.config.RegisterConstructorMapper;
import org.jdbi.v3.sqlobject.customizer.Bind;
import org.jdbi.v3.sqlobject.statement.SqlQuery;

/**
 * Read side of the installment charge pass. Returns the minimal projection the
 * scheduler needs to route and execute a due installment, joining each
 * chargeable {@code payment_schedule} row to its plan's rail and to the Mews
 * ids on the customer and card. Kept separate from {@link PaymentScheduleDao}
 * so the projection's constructor mapper does not collide with that DAO's row
 * mapper.
 */
public interface DueChargeDao {

    /**
     * Installments that are due to charge on or before {@code asOf}: status is
     * {@code scheduled} or {@code retrying} (so {@code processing}/{@code paid}/
     * {@code failed} rows are excluded — critically, an in-flight
     * {@code processing} Mews charge is never re-selected and so never
     * double-charged), and the owning plan is still {@code active}. Ordered by
     * due date then sequence so earlier installments charge first.
     */
    @SqlQuery("""
            SELECT ps.id                 AS schedule_id,
                   ps.payment_plan_id    AS plan_id,
                   b.merchant_id         AS merchant_id,
                   ps.sequence           AS sequence,
                   ps.amount_cents       AS amount_cents,
                   ps.kind               AS kind,
                   pp.payment_rail       AS payment_rail,
                   c.mews_customer_id    AS mews_customer_id,
                   cc.mews_credit_card_id AS mews_credit_card_id
            FROM payment_schedule ps
            JOIN payment_plans   pp ON pp.id = ps.payment_plan_id
            JOIN bookings         b ON b.id  = pp.booking_id
            JOIN customers        c ON c.id  = pp.customer_id
            JOIN customer_cards  cc ON cc.id = pp.customer_card_id
            WHERE ps.status IN ('scheduled', 'retrying')
              AND ps.due_date <= :asOf
              AND pp.status = 'active'
            ORDER BY ps.due_date ASC, ps.sequence ASC
            """)
    @RegisterConstructorMapper(DueInstallment.class)
    List<DueInstallment> findDueForCharge(@Bind("asOf") LocalDate asOf);

    /**
     * One due installment plus the routing context it needs. {@code kind} and
     * {@code paymentRail} are the raw wire strings; the service maps them.
     * {@code mewsCustomerId}/{@code mewsCreditCardId} are null on Stripe-rail
     * plans (and on Mews plans that have not vaulted a card yet).
     */
    record DueInstallment(
            @ColumnName("schedule_id") UUID scheduleId,
            @ColumnName("plan_id") UUID planId,
            @ColumnName("merchant_id") UUID merchantId,
            @ColumnName("sequence") int sequence,
            @ColumnName("amount_cents") long amountCents,
            @ColumnName("kind") String kind,
            @ColumnName("payment_rail") String paymentRail,
            @ColumnName("mews_customer_id") String mewsCustomerId,
            @ColumnName("mews_credit_card_id") String mewsCreditCardId) {
    }
}
