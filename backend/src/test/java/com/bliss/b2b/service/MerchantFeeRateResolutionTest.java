package com.bliss.b2b.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import com.bliss.b2b.persistence.MerchantFeeRateDao;
import java.math.BigDecimal;
import java.sql.Connection;
import java.sql.DriverManager;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import org.jdbi.v3.core.Handle;
import org.jdbi.v3.core.Jdbi;
import org.jdbi.v3.sqlobject.SqlObjectPlugin;
import org.junit.jupiter.api.Test;

/**
 * Resolution ordering for {@code merchant_fee_rates}. This is SQL, so it needs a
 * real Postgres; there is no Testcontainers in this project yet, so the test
 * SKIPS rather than fails when one is not reachable. CI stays green and the
 * coverage is real when run locally against the dev database.
 *
 * <p>Every test runs inside a transaction that is always rolled back, so it
 * writes nothing durable even though it uses the live schema.
 *
 * <p>Point it somewhere else with {@code BLISS_TEST_DB_URL} if the dev database
 * is not the default.
 */
class MerchantFeeRateResolutionTest {

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

    /**
     * Runs the body against a scratch merchant and always rolls back.
     * The merchant is created inside the same transaction, so it disappears
     * with everything else.
     */
    private void withScratchMerchant(java.util.function.BiConsumer<Handle, UUID> body) {
        Jdbi jdbi = jdbiOrSkip();
        jdbi.useHandle(handle -> {
            handle.begin();
            try {
                UUID merchantId = handle.createQuery("""
                        INSERT INTO merchants (slug, email, status)
                        VALUES (:slug, :email, 'active')
                        RETURNING id
                        """)
                        .bind("slug", "feetest-" + UUID.randomUUID().toString().substring(0, 8))
                        .bind("email", UUID.randomUUID() + "@feetest.invalid")
                        .mapTo(UUID.class)
                        .one();
                body.accept(handle, merchantId);
            } finally {
                handle.rollback();
            }
        });
    }

    private static void insertRate(Handle h, UUID merchantId, String rate, Instant effectiveFrom) {
        h.attach(MerchantFeeRateDao.class)
                .insertRate(merchantId, new BigDecimal(rate), effectiveFrom, "test", null);
    }

    @Test
    void resolvesTheRateInForceAtTheGivenInstant() {
        withScratchMerchant((h, merchantId) -> {
            insertRate(h, merchantId, "0.05000", NOW.minus(30, ChronoUnit.DAYS));
            BigDecimal rate = h.attach(MerchantFeeRateDao.class)
                    .effectiveRateFor(merchantId, NOW)
                    .orElseThrow();
            assertThat(rate).isEqualByComparingTo("0.05000");
        });
    }

    @Test
    void aNewerRowWins() {
        withScratchMerchant((h, merchantId) -> {
            insertRate(h, merchantId, "0.05000", NOW.minus(30, ChronoUnit.DAYS));
            insertRate(h, merchantId, "0.00000", NOW.minus(1, ChronoUnit.SECONDS));
            assertThat(h.attach(MerchantFeeRateDao.class)
                    .effectiveRateFor(merchantId, NOW).orElseThrow())
                    .isEqualByComparingTo("0.00000");
        });
    }

    @Test
    void aZeroRateResolvesAsZeroAndNotAsAbsent() {
        // The distinction that matters: empty means "no rate configured, fall
        // back", zero means "this property is charged nothing". They must not
        // be conflated, because the fallback is 5%.
        withScratchMerchant((h, merchantId) -> {
            insertRate(h, merchantId, "0.00000", NOW.minus(1, ChronoUnit.DAYS));
            var resolved = h.attach(MerchantFeeRateDao.class).effectiveRateFor(merchantId, NOW);
            assertThat(resolved).isPresent();
            assertThat(resolved.get()).isEqualByComparingTo("0");
            assertThat(PlanCreationService.feeFor(99_415L, resolved.get())).isEqualTo(0L);
        });
    }

    @Test
    void aFutureRowIsNotAppliedYet() {
        withScratchMerchant((h, merchantId) -> {
            insertRate(h, merchantId, "0.05000", NOW.minus(30, ChronoUnit.DAYS));
            insertRate(h, merchantId, "0.10000", NOW.plus(7, ChronoUnit.DAYS));

            assertThat(h.attach(MerchantFeeRateDao.class)
                    .effectiveRateFor(merchantId, NOW).orElseThrow())
                    .isEqualByComparingTo("0.05000");
            // ...and it does apply once that moment arrives.
            assertThat(h.attach(MerchantFeeRateDao.class)
                    .effectiveRateFor(merchantId, NOW.plus(8, ChronoUnit.DAYS)).orElseThrow())
                    .isEqualByComparingTo("0.10000");
        });
    }

    @Test
    void aRowEffectiveExactlyNowApplies() {
        withScratchMerchant((h, merchantId) -> {
            insertRate(h, merchantId, "0.02000", NOW);
            assertThat(h.attach(MerchantFeeRateDao.class)
                    .effectiveRateFor(merchantId, NOW).orElseThrow())
                    .isEqualByComparingTo("0.02000");
        });
    }

    @Test
    void noRowsResolvesEmptySoTheCallerCanFallBack() {
        withScratchMerchant((h, merchantId) ->
                assertThat(h.attach(MerchantFeeRateDao.class).effectiveRateFor(merchantId, NOW))
                        .isEmpty());
    }

    @Test
    void historyIsNewestFirstAndIncludesFutureRows() {
        withScratchMerchant((h, merchantId) -> {
            insertRate(h, merchantId, "0.05000", NOW.minus(30, ChronoUnit.DAYS));
            insertRate(h, merchantId, "0.00000", NOW.minus(1, ChronoUnit.DAYS));
            insertRate(h, merchantId, "0.10000", NOW.plus(7, ChronoUnit.DAYS));
            var history = h.attach(MerchantFeeRateDao.class).historyFor(merchantId);
            assertThat(history).hasSize(3);
            assertThat(history.get(0).rate()).isEqualByComparingTo("0.10000");
            assertThat(history.get(2).rate()).isEqualByComparingTo("0.05000");
        });
    }

    /**
     * The freezing property, end to end at the column level: a rate change after
     * a plan exists does not touch that plan's stored fee. This is what makes a
     * rate edit safe to make on a live property.
     */
    @Test
    void changingTheRateDoesNotRepriceAnExistingPlan() {
        withScratchMerchant((h, merchantId) -> {
            insertRate(h, merchantId, "0.05000", NOW.minus(30, ChronoUnit.DAYS));
            MerchantFeeRateDao rates = h.attach(MerchantFeeRateDao.class);

            long total = 99_415L;
            long feeAtCreation =
                    PlanCreationService.feeFor(total, rates.effectiveRateFor(merchantId, NOW).orElseThrow());
            assertThat(feeAtCreation).isEqualTo(4_971L);

            UUID planId = insertScratchPlan(h, merchantId, total, feeAtCreation);

            // The property moves to 0% from now on.
            insertRate(h, merchantId, "0.00000", NOW);

            // A plan created NOW would be free...
            assertThat(PlanCreationService.feeFor(
                    total, rates.effectiveRateFor(merchantId, NOW).orElseThrow()))
                    .isEqualTo(0L);

            // ...but the one that already exists is untouched.
            long stored = h.createQuery(
                            "SELECT processing_fee_cents FROM payment_plans WHERE id = :id")
                    .bind("id", planId)
                    .mapTo(Long.class)
                    .one();
            assertThat(stored).isEqualTo(4_971L);
        });
    }

    /** Minimal plan row: enough columns to satisfy NOT NULL, nothing more. */
    private static UUID insertScratchPlan(Handle h, UUID merchantId, long total, long feeCents) {
        UUID bookingId = h.createQuery("""
                INSERT INTO bookings
                    (merchant_id, booking_token, service_name, total_amount_cents, appointment_date)
                VALUES (:merchantId, :token, 'Fee rate test', :total, DATE '2027-01-01')
                RETURNING id
                """)
                .bind("merchantId", merchantId)
                .bind("token", UUID.randomUUID().toString().substring(0, 16))
                .bind("total", total)
                .mapTo(UUID.class)
                .one();
        UUID customerId = h.createQuery("""
                INSERT INTO customers (email) VALUES (:email) RETURNING id
                """)
                .bind("email", UUID.randomUUID() + "@feetest.invalid")
                .mapTo(UUID.class)
                .one();
        UUID cardId = h.createQuery("""
                INSERT INTO customer_cards
                    (customer_id, stripe_payment_method_id, brand, last_four, exp_month, exp_year)
                VALUES (:customerId, :pm, 'visa', '4242', 12, 2030)
                RETURNING id
                """)
                .bind("customerId", customerId)
                .bind("pm", "pm_feetest_" + UUID.randomUUID().toString().substring(0, 8))
                .mapTo(UUID.class)
                .one();
        return h.createQuery("""
                INSERT INTO payment_plans
                    (booking_id, customer_id, customer_card_id, total_amount_cents,
                     num_payments, frequency, start_date, end_date, processing_fee_cents)
                VALUES (:bookingId, :customerId, :cardId, :total,
                        6, 'monthly', DATE '2026-09-02', DATE '2027-02-02', :fee)
                RETURNING id
                """)
                .bind("bookingId", bookingId)
                .bind("customerId", customerId)
                .bind("cardId", cardId)
                .bind("total", total)
                .bind("fee", feeCents)
                .mapTo(UUID.class)
                .one();
    }
}
