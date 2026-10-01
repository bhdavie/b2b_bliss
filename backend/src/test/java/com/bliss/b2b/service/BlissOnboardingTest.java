package com.bliss.b2b.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import com.bliss.b2b.BlissConfiguration.FeaturesConfig;
import com.bliss.b2b.domain.Merchant;
import com.bliss.b2b.integration.EmailMessage;
import com.bliss.b2b.persistence.BlissRateDao;
import com.bliss.b2b.persistence.BlissSettingsDao;
import com.bliss.b2b.persistence.EmailLogDao;
import com.bliss.b2b.persistence.MerchantCloudbedsConnectionDao;
import com.bliss.b2b.persistence.MerchantDao;
import com.bliss.b2b.persistence.MerchantFeeRateDao;
import com.bliss.b2b.persistence.MerchantMewsConnectionDao;
import com.bliss.b2b.persistence.MerchantPlanRulesDao;
import com.bliss.b2b.persistence.MerchantStripeConnectionDao;
import com.bliss.b2b.persistence.MewsLinkingDao;
import com.bliss.b2b.persistence.migration.V30__Encrypt_pms_connection_tokens;
import com.bliss.b2b.security.TokenCipher;
import com.bliss.b2b.service.BlissSettingsService.SettingsException;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.Statement;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.jdbi.v3.core.Jdbi;
import org.jdbi.v3.sqlobject.SqlObjectPlugin;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

/**
 * Phase 6: switching Bliss on at the end of setup, and the Monday summary.
 * Throwaway Postgres; SKIPS without one.
 */
class BlissOnboardingTest {

    private static final String ADMIN_URL = System.getenv().getOrDefault(
            "BLISS_TEST_DB_URL", "jdbc:postgresql://localhost:5432/bliss");
    private static final String DB_NAME =
            "bliss_onboardtest_" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);
    /** A Monday. */
    private static final Instant MONDAY = Instant.parse("2026-10-05T14:00:00Z");

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

    private final List<EmailMessage> emails = new ArrayList<>();

    private BlissOnboardingService service() {
        Clock clock = Clock.fixed(MONDAY, ZoneOffset.UTC);
        MerchantDao merchants = jdbi.onDemand(MerchantDao.class);
        BlissSettingsService settings = new BlissSettingsService(jdbi.onDemand(BlissSettingsDao.class),
                jdbi.onDemand(MerchantPlanRulesDao.class), jdbi.onDemand(MerchantFeeRateDao.class),
                jdbi.onDemand(MerchantMewsConnectionDao.class), jdbi.onDemand(BlissRateDao.class),
                new FeaturesConfig(), clock);
        PropertyOnboardingService onboarding = new PropertyOnboardingService(merchants,
                jdbi.onDemand(MerchantMewsConnectionDao.class), jdbi.onDemand(MerchantStripeConnectionDao.class),
                jdbi.onDemand(MerchantCloudbedsConnectionDao.class), null, jdbi.onDemand(MewsLinkingDao.class),
                clock);
        // No Mews to reach: the first sync fails and Bliss goes on regardless.
        MewsSyncService sync = new MewsSyncService(jdbi, null, emails::add, clock);
        return new BlissOnboardingService(settings, onboarding, sync, merchants,
                jdbi.onDemand(MerchantMewsConnectionDao.class), jdbi.onDemand(BlissRateDao.class),
                jdbi.onDemand(EmailLogDao.class), emails::add, "https://app.bliss.test");
    }

    /** A Mews property, connected; with a monthly Bliss rate when {@code withRate}. */
    private static Merchant mewsProperty(boolean withRate) {
        UUID id = UUID.randomUUID();
        UUID merchantId = jdbi.withHandle(h -> {
            UUID m = h.createQuery("""
                    INSERT INTO merchants (slug, email, business_name, pms_type, currency, time_zone, locale,
                                           onboarding_state)
                    VALUES (:slug, :email, 'Test Inn', 'mews', 'USD', 'America/Detroit', 'en-US', 'pms_connected')
                    RETURNING id""")
                    .bind("slug", "o" + id.toString().substring(0, 8)).bind("email", id + "@inn.test")
                    .mapTo(UUID.class).one();
            h.createUpdate("""
                    INSERT INTO merchant_mews_connections (merchant_id, platform_url, client_token, access_token,
                        enterprise_id, enterprise_name, currency, validated_at, service_id, bliss_monthly_rate_id)
                    VALUES (:m, 'https://api.mews-demo.com', 'v1:ct', 'v1:at', 'ent', 'Test Inn', 'USD', now(),
                            'svc-stay', :rate)""")
                    .bind("m", m).bind("rate", withRate ? "rate-monthly" : null).execute();
            if (withRate) {
                h.createUpdate("""
                        INSERT INTO merchant_bliss_rates (merchant_id, mews_rate_id, frequency, rate_name, active,
                                                          cancellation_terms, derived_booking_type, synced_at)
                        VALUES (:m, 'rate-monthly', 'monthly', 'Monthly Bliss', TRUE, '[]', 'refundable', now())""")
                        .bind("m", m).execute();
            }
            return m;
        });
        return jdbi.onDemand(MerchantDao.class).findById(merchantId).orElseThrow();
    }

    @Test
    void switchingOnNeedsABlissRate() {
        Merchant m = mewsProperty(false);

        assertThatThrownBy(() -> service().switchOn(m))
                .extracting(e -> ((SettingsException) e).code()).isEqualTo("no_bliss_rates");
        assertThat(jdbi.onDemand(MerchantDao.class).findById(m.id()).orElseThrow().onboardingComplete()).isFalse();
    }

    @Test
    void switchingOnFinishesSetupAndEmailsTheHotelOnce() {
        Merchant m = mewsProperty(true);
        BlissOnboardingService service = service();

        BlissSettingsService.SettingsView view = service.switchOn(m);
        service.switchOn(m);

        assertThat(view.enabled()).isTrue();
        assertThat(jdbi.onDemand(MerchantDao.class).findById(m.id()).orElseThrow().onboardingComplete()).isTrue();
        assertThat(emails).singleElement().satisfies(e -> {
            assertThat(e.subject()).isEqualTo("Bliss is on");
            assertThat(e.to()).isEqualTo(m.email());
            assertThat(e.body()).contains("- Monthly Bliss, paid monthly. Free cancellation until arrival")
                    .contains("How you get paid: pay as you go")
                    .contains("https://app.bliss.test/settings")
                    .doesNotContain("—");
        });
    }

    @Test
    void thePopUpGetsEachBlissRatesTermsInOneLine() {
        Merchant m = mewsProperty(true);
        jdbi.useHandle(h -> {
            h.execute("UPDATE merchant_mews_connections SET bliss_biweekly_rate_id = 'rate-nr' WHERE merchant_id = ?",
                    m.id());
            h.createUpdate("""
                    INSERT INTO merchant_bliss_rates (merchant_id, mews_rate_id, frequency, rate_name, active,
                                                      cancellation_terms, derived_booking_type, synced_at)
                    VALUES (:m, 'rate-nr', 'biweekly', 'Bliss every 2 weeks', TRUE,
                            '[{"applicability":"Creation","applicabilityOffset":"P0M0DT0H0M0S",
                               "feeExtent":"TimeUnits","relativeFee":1}]', 'non_refundable', now())""")
                    .bind("m", m.id()).execute();
        });
        com.bliss.b2b.api.PublicMerchantsResource resource = new com.bliss.b2b.api.PublicMerchantsResource(
                jdbi.onDemand(MerchantDao.class),
                new MerchantPlanRulesService(jdbi.onDemand(MerchantPlanRulesDao.class)), null, null,
                jdbi.onDemand(MerchantFeeRateDao.class), jdbi.onDemand(MerchantMewsConnectionDao.class),
                Clock.fixed(MONDAY, ZoneOffset.UTC))
                .withBlissRates(jdbi.onDemand(BlissRateDao.class));

        com.bliss.b2b.api.PublicPlanRulesView view =
                (com.bliss.b2b.api.PublicPlanRulesView) resource.planRules(m.slug(), null).getEntity();

        assertThat(view.mewsBlissTerms())
                .containsEntry("monthly", "Free cancellation until arrival")
                .containsEntry("biweekly", "Non-refundable");
    }

    // --- Weekly summary --------------------------------------------------------

    private WeeklySummaryService summaries(Instant now) {
        return new WeeklySummaryService(jdbi, emails::add, "https://app.bliss.test", Clock.fixed(now, ZoneOffset.UTC));
    }

    /** A switched-on property with one plan made and one 300.00 payment collected this week. */
    private Merchant busyProperty() {
        Merchant m = mewsProperty(true);
        service().switchOn(m);
        emails.clear();
        UUID id = UUID.randomUUID();
        jdbi.useHandle(h -> {
            UUID booking = h.createQuery("""
                    INSERT INTO bookings (merchant_id, booking_token, service_name, total_amount_cents,
                                          appointment_date, status, booking_source, currency, time_zone, locale)
                    VALUES (:m, :t, 'Two nights', 60000, :d, 'accepted', 'merchant_initiated', 'USD',
                            'America/Detroit', 'en-US') RETURNING id""")
                    .bind("m", m.id()).bind("t", "tok-" + id.toString().substring(0, 12))
                    .bind("d", LocalDate.of(2027, 3, 1)).mapTo(UUID.class).one();
            UUID customer = h.createQuery("""
                    INSERT INTO customers (email, first_name, last_name) VALUES (:e, 'Guest', 'One') RETURNING id""")
                    .bind("e", "g-" + id + "@example.com").mapTo(UUID.class).one();
            UUID card = h.createQuery("""
                    INSERT INTO customer_cards (customer_id, stripe_payment_method_id, last_four, exp_month,
                                                exp_year, brand, is_default)
                    VALUES (:c, :pm, '4242', 12, 2030, 'visa', TRUE) RETURNING id""")
                    .bind("c", customer).bind("pm", "pm_" + id).mapTo(UUID.class).one();
            UUID plan = h.createQuery("""
                    INSERT INTO payment_plans (booking_id, customer_id, customer_card_id, total_amount_cents,
                                               num_payments, frequency, start_date, end_date,
                                               deposit_amount_cents, processing_fee_cents, status, created_at)
                    VALUES (:b, :c, :card, 60000, 2, 'monthly', :s, :e, 0, 0, 'active', :created) RETURNING id""")
                    .bind("b", booking).bind("c", customer).bind("card", card)
                    .bind("s", LocalDate.of(2026, 10, 2)).bind("e", LocalDate.of(2026, 11, 2))
                    .bind("created", MONDAY.minusSeconds(86_400)).mapTo(UUID.class).one();
            h.createUpdate("""
                    INSERT INTO payment_schedule (payment_plan_id, sequence, due_date, amount_cents, status, kind,
                                                  paid_at)
                    VALUES (:p, 1, :d, 30000, 'paid', 'installment', :paid)""")
                    .bind("p", plan).bind("d", LocalDate.of(2026, 10, 2)).bind("paid", MONDAY.minusSeconds(86_400))
                    .execute();
        });
        return m;
    }

    @Test
    void theMondaySummaryGoesOncePerWeek() {
        Merchant m = busyProperty();

        assertThat(summaries(MONDAY).sendIfDue(m.id(), MONDAY)).isTrue();
        assertThat(summaries(MONDAY).sendIfDue(m.id(), MONDAY.plusSeconds(3_600))).isFalse();

        assertThat(emails).singleElement().satisfies(e -> {
            assertThat(e.subject()).isEqualTo("Your week with Bliss");
            assertThat(e.body()).contains("- New plans: 1").contains("- Payments collected: $300.00")
                    .doesNotContain("—");
        });
    }

    @Test
    void noSummaryOnOtherDaysOrInAQuietWeek() {
        Merchant busy = busyProperty();
        assertThat(summaries(MONDAY).sendIfDue(busy.id(), MONDAY.plusSeconds(86_400))).as("Tuesday").isFalse();

        Merchant quiet = mewsProperty(true);
        service().switchOn(quiet);
        emails.clear();
        assertThat(summaries(MONDAY).sendIfDue(quiet.id(), MONDAY)).isFalse();
        assertThat(emails).isEmpty();
    }

    @Test
    void mondayIsInThePropertysOwnZone() {
        Merchant m = busyProperty();
        // 01:00 UTC on Monday is still Sunday evening in Detroit.
        assertThat(summaries(MONDAY).sendIfDue(m.id(), Instant.parse("2026-10-05T01:00:00Z"))).isFalse();
    }
}
