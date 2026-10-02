package com.bliss.b2b.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import com.bliss.b2b.BlissConfiguration.StripeConfig;
import com.bliss.b2b.api.PublicMerchantView;
import com.bliss.b2b.api.PublicMerchantsResource;
import com.bliss.b2b.domain.Merchant;
import com.bliss.b2b.integration.StripeConnectResolver;
import com.bliss.b2b.integration.StripeDemoPolicy;
import com.bliss.b2b.integration.StripePaymentsService;
import com.bliss.b2b.persistence.DueChargeDao.DueInstallment;
import com.bliss.b2b.persistence.MerchantDao;
import com.bliss.b2b.persistence.MerchantFeeRateDao;
import com.bliss.b2b.persistence.MerchantMewsConnectionDao;
import com.bliss.b2b.persistence.MerchantPlanRulesDao;
import com.bliss.b2b.persistence.migration.V30__Encrypt_pms_connection_tokens;
import com.bliss.b2b.security.TokenCipher;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.Statement;
import java.time.Clock;
import java.time.LocalDate;
import java.util.Map;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.jdbi.v3.core.Jdbi;
import org.jdbi.v3.sqlobject.SqlObjectPlugin;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

/**
 * Demo properties stay in Stripe demo mode with keys set: the scheduled charge
 * settles with a synthetic intent and never calls Stripe, the hosted page gets
 * no publishable key, and a demo id that somehow reaches a Stripe call is
 * refused before any request. Stripe is "configured" here with a fake key, so a
 * real call would fail loudly. Throwaway Postgres; SKIPS without one.
 */
class StripeDemoModeTest {

    private static final String ADMIN_URL = System.getenv().getOrDefault(
            "BLISS_TEST_DB_URL", "jdbc:postgresql://localhost:5432/bliss");
    private static final String DB_NAME =
            "bliss_demomodetest_" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);

    private static Jdbi jdbi;
    private static String dbUrl;

    @BeforeAll
    static void createDatabase() {
        try (Connection admin = DriverManager.getConnection(ADMIN_URL); Statement st = admin.createStatement()) {
            assumeTrue(admin.isValid(2), "database not reachable; skipping");
            st.execute("CREATE DATABASE " + DB_NAME);
        } catch (Exception e) {
            assumeTrue(false, "cannot create a test database (" + e.getMessage() + "); skipping");
        }
        int slash = ADMIN_URL.lastIndexOf('/');
        int query = ADMIN_URL.indexOf('?', slash);
        dbUrl = ADMIN_URL.substring(0, slash + 1) + DB_NAME + (query < 0 ? "" : ADMIN_URL.substring(query));
        Flyway.configure().dataSource(dbUrl, null, null).locations("classpath:db/migration")
                .javaMigrations(new V30__Encrypt_pms_connection_tokens(TokenCipher.development()))
                .load().migrate();
        jdbi = Jdbi.create(dbUrl).installPlugin(new SqlObjectPlugin());
    }

    @AfterAll
    static void dropDatabase() throws Exception {
        if (dbUrl == null) return;
        try (Connection admin = DriverManager.getConnection(ADMIN_URL); Statement st = admin.createStatement()) {
            st.execute("DROP DATABASE IF EXISTS " + DB_NAME + " WITH (FORCE)");
        }
    }

    private static final StripeDemoPolicy POLICY =
            new StripeDemoPolicy("demo-mews-slug", "demo@marbrookhouse.test");

    /** Stripe as production will have it once live keys are set (a fake key: no call may succeed). */
    private static StripePaymentsService liveKeys() {
        StripeConfig config = new StripeConfig();
        config.setSecretKey("sk_test_bliss_fake_key_never_valid");
        config.setPublishableKey("pk_test_bliss_fake");
        return new StripePaymentsService(config).withDemoPolicy(POLICY);
    }

    private static Merchant merchant(String slug, String email, String connectAccount) {
        UUID id = jdbi.withHandle(h -> h.createQuery("""
                        INSERT INTO merchants (slug, email, business_name, pms_type, currency, time_zone, locale,
                                               onboarding_state, stripe_connect_account_id, stripe_connect_status)
                        VALUES (:s, :e, 'Marbrook Lodge', 'stripe', 'USD', 'America/New_York', 'en-US', 'active',
                                :a, 'charges_enabled') RETURNING id""")
                .bind("s", slug).bind("e", email).bind("a", connectAccount).mapTo(UUID.class).one());
        return jdbi.onDemand(MerchantDao.class).findById(id).orElseThrow();
    }

    private static String slug() {
        return "d" + UUID.randomUUID().toString().substring(0, 7);
    }

    @Test
    void everyKindOfDemoPropertyIsDemo_aRealOneIsLive() {
        StripePaymentsService stripe = liveKeys();

        assertThat(stripe.isLiveFor(merchant(slug(), "a@lodge.test", "acct_demo_9c41e6d70b2a")))
                .as("synthetic Connect account").isFalse();
        assertThat(stripe.isLiveFor(merchant(slug(), "Demo@MarbrookHouse.test", null)))
                .as("demo login, any case").isFalse();
        assertThat(stripe.isLiveFor(merchant("demo-mews-slug", "b@house.test", null)))
                .as("listed demo Mews property").isFalse();
        assertThat(stripe.isLiveFor(merchant(slug(), "owner@cranberry.test", "acct_1RealAccount")))
                .as("a real property").isTrue();
    }

    @Test
    void aDemoPropertysScheduledPaymentSettlesWithoutCallingStripe() {
        Merchant demo = merchant(slug(), "c@lodge.test", "acct_demo_2f7c93ab55e1");
        UUID scheduleId = jdbi.withHandle(h -> {
            UUID booking = h.createQuery("""
                    INSERT INTO bookings (merchant_id, booking_token, service_name, total_amount_cents,
                                          appointment_date, status, booking_source, currency)
                    VALUES (:m, :t, 'Two nights', 60000, :d, 'accepted', 'merchant_initiated', 'USD') RETURNING id""")
                    .bind("m", demo.id()).bind("t", "tok-" + UUID.randomUUID()).bind("d", LocalDate.of(2027, 3, 1))
                    .mapTo(UUID.class).one();
            UUID customer = h.createQuery("""
                    INSERT INTO customers (email, first_name, last_name, stripe_customer_id)
                    VALUES (:e, 'Guest', 'One', 'cus_demo_1234') RETURNING id""")
                    .bind("e", "g-" + UUID.randomUUID() + "@example.com").mapTo(UUID.class).one();
            UUID card = h.createQuery("""
                    INSERT INTO customer_cards (customer_id, stripe_payment_method_id, last_four, exp_month,
                                                exp_year, brand, is_default)
                    VALUES (:c, :pm, '4242', 12, 2030, 'visa', TRUE) RETURNING id""")
                    .bind("c", customer).bind("pm", "pm_demo_" + UUID.randomUUID()).mapTo(UUID.class).one();
            UUID plan = h.createQuery("""
                    INSERT INTO payment_plans (booking_id, customer_id, customer_card_id, total_amount_cents,
                                               num_payments, frequency, start_date, end_date,
                                               deposit_amount_cents, processing_fee_cents, status, payment_rail)
                    VALUES (:b, :c, :card, 60000, 2, 'monthly', :s, :e, 0, 0, 'active', 'stripe') RETURNING id""")
                    .bind("b", booking).bind("c", customer).bind("card", card)
                    .bind("s", LocalDate.of(2026, 10, 2)).bind("e", LocalDate.of(2026, 11, 2))
                    .mapTo(UUID.class).one();
            return h.createQuery("""
                    INSERT INTO payment_schedule (payment_plan_id, sequence, due_date, amount_cents, status, kind)
                    VALUES (:p, 1, :d, 30000, 'scheduled', 'installment') RETURNING id""")
                    .bind("p", plan).bind("d", LocalDate.of(2026, 10, 2)).mapTo(UUID.class).one();
        });
        UUID planId = jdbi.withHandle(h -> h.createQuery(
                "SELECT payment_plan_id FROM payment_schedule WHERE id = :s").bind("s", scheduleId)
                .mapTo(UUID.class).one());
        JdbiStripeInstallmentCharger charger = new JdbiStripeInstallmentCharger(
                jdbi, liveKeys(), new StripeConnectResolver(jdbi), Clock.systemUTC());

        InstallmentChargeService.StripeChargeOutcome outcome = charger.charge(new DueInstallment(
                scheduleId, planId, demo.id(), 1, 30_000, "USD", "installment", "stripe", null, null, null));

        assertThat(outcome).isEqualTo(InstallmentChargeService.StripeChargeOutcome.PAID);
        Map<String, Object> row = jdbi.withHandle(h -> h.createQuery(
                        "SELECT status, stripe_payment_intent_id FROM payment_schedule WHERE id = :s")
                .bind("s", scheduleId).mapToMap().one());
        assertThat(row).containsEntry("status", "paid");
        assertThat((String) row.get("stripe_payment_intent_id")).startsWith("pi_demo_");
    }

    @Test
    void aDemoPropertysHostedPageGetsNoPublishableKey() {
        Merchant demo = merchant(slug(), "demo@marbrookhouse.test", null);
        Merchant real = merchant(slug(), "owner@real.test", null);
        PublicMerchantsResource resource = new PublicMerchantsResource(jdbi.onDemand(MerchantDao.class),
                new MerchantPlanRulesService(jdbi.onDemand(MerchantPlanRulesDao.class)), liveKeys(),
                new StripeConnectResolver(jdbi), jdbi.onDemand(MerchantFeeRateDao.class),
                jdbi.onDemand(MerchantMewsConnectionDao.class), Clock.systemUTC());

        PublicMerchantView demoView = (PublicMerchantView) resource.get(demo.slug()).getEntity();
        PublicMerchantView realView = (PublicMerchantView) resource.get(real.slug()).getEntity();

        assertThat(demoView.stripe().configured()).isFalse();
        assertThat(demoView.stripe().publishableKey()).isNull();
        assertThat(realView.stripe().configured()).isTrue();
        assertThat(realView.stripe().publishableKey()).isEqualTo("pk_test_bliss_fake");
    }

    @Test
    void aDemoIdThatReachesAStripeCallIsRefusedBeforeAnyRequest() {
        StripePaymentsService stripe = liveKeys();

        assertThatThrownBy(() -> stripe.firePaymentOffSession(30_000, "USD", "cus_demo_1234", "pm_real_card",
                "key-1", Map.of(), null, StripePaymentsService.SessionMode.OFF_SESSION))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("never reaches Stripe");
        assertThatThrownBy(() -> stripe.firePaymentOffSession(30_000, "USD", "cus_RealCustomer", "pm_seed_1",
                "key-2", Map.of(), null, StripePaymentsService.SessionMode.OFF_SESSION))
                .isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> stripe.firePaymentOffSession(30_000, "USD", "cus_RealCustomer", "pm_real_card",
                "key-3", Map.of(), new StripePaymentsService.Destination("acct_demo_9c41e6d70b2a", null),
                StripePaymentsService.SessionMode.OFF_SESSION))
                .isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> stripe.refundPaymentIntent("pi_demo_abc", 100, "key-4"))
                .isInstanceOf(IllegalStateException.class);
    }
}
