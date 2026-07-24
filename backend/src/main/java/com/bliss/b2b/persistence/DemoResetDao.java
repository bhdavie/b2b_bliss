package com.bliss.b2b.persistence;

import java.util.List;
import java.util.UUID;
import org.jdbi.v3.sqlobject.customizer.BindList;
import org.jdbi.v3.sqlobject.statement.SqlQuery;
import org.jdbi.v3.sqlobject.statement.SqlUpdate;

/**
 * Deletes for the dev-only demo reset. Every statement is scoped to
 * {@code merchants.is_demo = true} (directly or through a join), so a non-demo
 * property and its data can never be reached. Each delete returns its row count
 * for the reset summary.
 *
 * <p>The service calls these in strict FK order (children before parents):
 * schedule, plans, bookings, plan rules, mews connections, magic-link tokens,
 * then the orphaned consumers, then the merchants themselves.
 */
public interface DemoResetDao {

    @SqlQuery("SELECT email FROM merchants WHERE is_demo = true ORDER BY email")
    List<String> selectDemoMerchantEmails();

    /**
     * Customer ids referenced by demo plans, captured BEFORE any delete runs (the
     * merchant link is gone once bookings/plans are deleted). Used afterward to
     * purge consumers left with zero remaining plans.
     */
    @SqlQuery("""
            SELECT DISTINCT pp.customer_id
            FROM payment_plans pp
            JOIN bookings b ON b.id = pp.booking_id
            JOIN merchants m ON m.id = b.merchant_id
            WHERE m.is_demo = true
            """)
    List<UUID> selectCustomerIdsForDemoPlans();

    // --- 1..6: merchant-owned data, children first ---

    @SqlUpdate("""
            DELETE FROM payment_schedule
            WHERE payment_plan_id IN (
                SELECT pp.id FROM payment_plans pp
                JOIN bookings b ON b.id = pp.booking_id
                JOIN merchants m ON m.id = b.merchant_id
                WHERE m.is_demo = true)
            """)
    int deleteDemoScheduleEntries();

    @SqlUpdate("""
            DELETE FROM payment_plans
            WHERE booking_id IN (
                SELECT b.id FROM bookings b
                JOIN merchants m ON m.id = b.merchant_id
                WHERE m.is_demo = true)
            """)
    int deleteDemoPlans();

    @SqlUpdate("""
            DELETE FROM bookings
            WHERE merchant_id IN (SELECT id FROM merchants WHERE is_demo = true)
            """)
    int deleteDemoBookings();

    @SqlUpdate("""
            DELETE FROM merchant_plan_rules
            WHERE merchant_id IN (SELECT id FROM merchants WHERE is_demo = true)
            """)
    int deleteDemoPlanRules();

    @SqlUpdate("""
            DELETE FROM merchant_mews_connections
            WHERE merchant_id IN (SELECT id FROM merchants WHERE is_demo = true)
            """)
    int deleteDemoMewsConnections();

    @SqlUpdate("""
            DELETE FROM magic_link_tokens
            WHERE merchant_id IN (SELECT id FROM merchants WHERE is_demo = true)
            """)
    int deleteDemoMagicLinkTokens();

    // --- 7..8: orphaned consumers (only those with zero remaining plans) ---

    /**
     * Deletes cards of the given (demo-linked) customers that now have no plan
     * left. A card belongs to one customer, so a customer with zero remaining
     * plans has no plan referencing any of their cards, making this FK-safe.
     */
    @SqlUpdate("""
            DELETE FROM customer_cards
            WHERE customer_id IN (<customerIds>)
              AND customer_id NOT IN (SELECT customer_id FROM payment_plans)
            """)
    int deleteCardsForOrphanCustomers(@BindList("customerIds") List<UUID> customerIds);

    /**
     * Deletes the given (demo-linked) customers that have no plan left. A
     * customer still referenced by a surviving (non-demo) plan is spared.
     */
    @SqlUpdate("""
            DELETE FROM customers
            WHERE id IN (<customerIds>)
              AND id NOT IN (SELECT customer_id FROM payment_plans)
            """)
    int deleteOrphanCustomers(@BindList("customerIds") List<UUID> customerIds);

    // --- 9: the demo merchants themselves (cascades tokens/mews if any remain) ---

    @SqlUpdate("DELETE FROM merchants WHERE is_demo = true")
    int deleteDemoMerchants();
}
