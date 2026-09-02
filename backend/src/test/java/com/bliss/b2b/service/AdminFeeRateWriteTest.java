package com.bliss.b2b.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import com.bliss.b2b.persistence.MerchantFeeRateDao;
import java.math.BigDecimal;
import java.sql.Connection;
import java.sql.DriverManager;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.jdbi.v3.core.Handle;
import org.jdbi.v3.core.Jdbi;
import org.jdbi.v3.sqlobject.SqlObjectPlugin;
import org.junit.jupiter.api.Test;

/**
 * The guarantee the admin fee-rate write has to hold: appending a rate changes
 * what the NEXT plan is priced at and nothing else. No existing
 * {@code payment_plans.processing_fee_cents} may move.
 *
 * <p>Needs a real Postgres, so it SKIPS when one is not reachable, matching
 * {@link MerchantFeeRateResolutionTest}. Everything runs inside a transaction
 * that is always rolled back.
 */
class AdminFeeRateWriteTest {

    private static final String URL = System.getenv().getOrDefault(
            "BLISS_TEST_DB_URL", "jdbc:postgresql://localhost:5432/bliss");

    private static final Instant NOW = Instant.parse("2026-09-02T12:00:00Z");

    private static Jdbi jdbiOrSkip() {
        try (Connection probe = DriverManager.getConnection(URL)) {
            assumeTrue(probe.isValid(2), "database not reachable; skipping");
        } catch (Exception e) {
            assumeTrue(false, "database not reachable (" + e.getMessage() + "); skipping");
        }
        return Jdbi.create(URL).installPlugin(new SqlObjectPlugin());
    }

    private void inRolledBackTransaction(java.util.function.Consumer<Handle> body) {
        jdbiOrSkip().useHandle(handle -> {
            handle.begin();
            try {
                body.accept(handle);
            } finally {
                handle.rollback();
            }
        });
    }

    @Test
    void postingANewRateLeavesEveryExistingPlanFeeUntouched() {
        inRolledBackTransaction(h -> {
            UUID merchantId = scratchMerchant(h);
            MerchantFeeRateDao rates = h.attach(MerchantFeeRateDao.class);
            rates.insertRate(merchantId, new BigDecimal("0.05000"),
                    NOW.minus(30, ChronoUnit.DAYS), "seed", null);

            // Three plans priced under the 5% row, with different totals so a
            // blanket overwrite would be obvious.
            List<Long> totals = List.of(99_415L, 248_000L, 115_000L);
            Map<UUID, Long> feesBefore = new java.util.LinkedHashMap<>();
            for (long total : totals) {
                long fee = PlanCreationService.feeFor(
                        total, rates.effectiveRateFor(merchantId, NOW).orElseThrow());
                feesBefore.put(scratchPlan(h, merchantId, total, fee), fee);
            }
            assertThat(feesBefore.values()).containsExactly(4_971L, 12_400L, 5_750L);

            // The admin drops this property to 0%, effective now.
            rates.insertRate(merchantId, new BigDecimal("0.00000"), NOW, "admin set 0%", null);

            // The next plan would be free...
            assertThat(PlanCreationService.feeFor(
                    99_415L, rates.effectiveRateFor(merchantId, NOW).orElseThrow()))
                    .isEqualTo(0L);

            // ...and every plan that already existed is byte-for-byte unchanged.
            feesBefore.forEach((planId, expected) -> {
                long stored = h.createQuery(
                                "SELECT processing_fee_cents FROM payment_plans WHERE id = :id")
                        .bind("id", planId).mapTo(Long.class).one();
                assertThat(stored).as("plan %s", planId).isEqualTo(expected);
            });

            // Belt and braces: nothing on this merchant moved at all.
            long changed = h.createQuery("""
                    SELECT COUNT(*) FROM payment_plans p
                    JOIN bookings b ON b.id = p.booking_id
                    WHERE b.merchant_id = :id AND p.processing_fee_cents = 0
                    """)
                    .bind("id", merchantId).mapTo(Long.class).one();
            assertThat(changed).isZero();
        });
    }

    @Test
    void appendingARateNeverRemovesHistory() {
        inRolledBackTransaction(h -> {
            UUID merchantId = scratchMerchant(h);
            MerchantFeeRateDao rates = h.attach(MerchantFeeRateDao.class);
            rates.insertRate(merchantId, new BigDecimal("0.05000"),
                    NOW.minus(30, ChronoUnit.DAYS), "seed", null);
            rates.insertRate(merchantId, new BigDecimal("0.00000"), NOW, "admin set 0%", null);

            assertThat(rates.historyFor(merchantId)).hasSize(2);
            // The superseded row is still there and still says what it said.
            assertThat(rates.historyFor(merchantId).get(1).rate()).isEqualByComparingTo("0.05000");
        });
    }

    /**
     * The derived rate the admin detail view reports, exercised against the two
     * cases that must not produce a number: a legacy flat fee, and a fee that
     * is not a clean percentage of the total.
     */
    @Test
    void derivedRateUsesThePlanTotalAndRefusesToGuess() {
        // A real 5% plan.
        assertThat(AdminMerchantsService.derivedRate(99_415L, 4_971L))
                .isEqualByComparingTo("0.05000");
        // The pre-V13 flat $20: implies 0.01111, which nobody ever configured.
        assertThat(AdminMerchantsService.derivedRate(180_000L, 2_000L)).isNull();
        // Missing plan.
        assertThat(AdminMerchantsService.derivedRate(null, null)).isNull();
        // Zero total cannot imply a rate.
        assertThat(AdminMerchantsService.derivedRate(0L, 100L)).isNull();
        // A zero-rate plan is a real answer, not an absent one.
        assertThat(AdminMerchantsService.derivedRate(99_415L, 0L))
                .isEqualByComparingTo("0.00000");
    }

    // ------------------------------------------------------------- fixtures

    private static UUID scratchMerchant(Handle h) {
        return h.createQuery("""
                INSERT INTO merchants (slug, email, status)
                VALUES (:slug, :email, 'active') RETURNING id
                """)
                .bind("slug", "adminfee-" + UUID.randomUUID().toString().substring(0, 8))
                .bind("email", UUID.randomUUID() + "@adminfee.invalid")
                .mapTo(UUID.class).one();
    }

    private static UUID scratchPlan(Handle h, UUID merchantId, long total, long feeCents) {
        UUID bookingId = h.createQuery("""
                INSERT INTO bookings
                    (merchant_id, booking_token, service_name, total_amount_cents, appointment_date)
                VALUES (:merchantId, :token, 'Admin fee test', :total, DATE '2027-01-01')
                RETURNING id
                """)
                .bind("merchantId", merchantId)
                .bind("token", UUID.randomUUID().toString().substring(0, 16))
                .bind("total", total)
                .mapTo(UUID.class).one();
        UUID customerId = h.createQuery("INSERT INTO customers (email) VALUES (:e) RETURNING id")
                .bind("e", UUID.randomUUID() + "@adminfee.invalid")
                .mapTo(UUID.class).one();
        UUID cardId = h.createQuery("""
                INSERT INTO customer_cards
                    (customer_id, stripe_payment_method_id, brand, last_four, exp_month, exp_year)
                VALUES (:c, :pm, 'visa', '4242', 12, 2030) RETURNING id
                """)
                .bind("c", customerId)
                .bind("pm", "pm_adminfee_" + UUID.randomUUID().toString().substring(0, 8))
                .mapTo(UUID.class).one();
        return h.createQuery("""
                INSERT INTO payment_plans
                    (booking_id, customer_id, customer_card_id, total_amount_cents,
                     num_payments, frequency, start_date, end_date, processing_fee_cents)
                VALUES (:b, :c, :card, :total, 6, 'monthly',
                        DATE '2026-09-02', DATE '2027-02-02', :fee)
                RETURNING id
                """)
                .bind("b", bookingId).bind("c", customerId).bind("card", cardId)
                .bind("total", total).bind("fee", feeCents)
                .mapTo(UUID.class).one();
    }
}
