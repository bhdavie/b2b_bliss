package com.bliss.b2b.persistence;

import java.util.Optional;
import java.util.UUID;
import org.jdbi.v3.sqlobject.customizer.Bind;
import org.jdbi.v3.sqlobject.statement.SqlQuery;
import org.jdbi.v3.sqlobject.statement.SqlUpdate;

/**
 * Future-stay credits issued when a Mews-rail plan is cancelled (V32). Bliss is
 * the record; the hotel applies a credit by hand when the guest books again.
 */
public interface GuestCreditDao {

    /**
     * Issues the credit for a cancelled plan. Idempotent on the plan: a second
     * call changes nothing and returns 0, so a retried cancel never credits
     * twice.
     */
    @SqlUpdate("""
            INSERT INTO guest_credits (
                merchant_id, customer_id, source_plan_id, amount_cents, currency, note
            ) VALUES (
                :merchantId, :customerId, :sourcePlanId, :amountCents, :currency, :note
            )
            ON CONFLICT (source_plan_id) DO NOTHING
            """)
    int issue(
            @Bind("merchantId") UUID merchantId,
            @Bind("customerId") UUID customerId,
            @Bind("sourcePlanId") UUID sourcePlanId,
            @Bind("amountCents") long amountCents,
            @Bind("currency") String currency,
            @Bind("note") String note);

    /** The credit already issued for a plan, if any. */
    @SqlQuery("SELECT amount_cents FROM guest_credits WHERE source_plan_id = :planId")
    Optional<Long> findAmountForPlan(@Bind("planId") UUID planId);
}
