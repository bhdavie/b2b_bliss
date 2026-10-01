package com.bliss.b2b.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import com.bliss.b2b.BlissConfiguration.FeaturesConfig;
import com.bliss.b2b.domain.Merchant;
import com.bliss.b2b.persistence.BlissSettingsDao;
import com.bliss.b2b.persistence.BookingDao;
import com.bliss.b2b.persistence.MerchantDao;
import com.bliss.b2b.persistence.MerchantFeeRateDao;
import com.bliss.b2b.persistence.MerchantMewsConnectionDao;
import com.bliss.b2b.persistence.MerchantPlanRulesDao;
import com.bliss.b2b.persistence.migration.V30__Encrypt_pms_connection_tokens;
import com.bliss.b2b.security.TokenCipher;
import com.bliss.b2b.service.BlissSettingsService.Setting;
import com.bliss.b2b.service.BlissSettingsService.SettingsException;
import com.bliss.b2b.service.BlissSettingsService.SettingsView;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.Statement;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.jdbi.v3.core.Jdbi;
import org.jdbi.v3.sqlobject.SqlObjectPlugin;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

/**
 * Phase 1 of the configurable-property spec: every property has every setting
 * the moment it exists, Bliss can be switched on with no configuration, and
 * the settings Bliss owns can be changed. Throwaway Postgres; SKIPS without one.
 */
class BlissSettingsServiceTest {

    private static final String ADMIN_URL = System.getenv().getOrDefault(
            "BLISS_TEST_DB_URL", "jdbc:postgresql://localhost:5432/bliss");
    private static final String DB_NAME =
            "bliss_settingstest_" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);
    private static final Clock CLOCK = Clock.fixed(Instant.parse("2026-10-01T12:00:00Z"), ZoneOffset.UTC);

    private static Jdbi jdbi;
    private static String dbUrl;
    /** A property that existed, fully set up, before V38 ran. */
    private static UUID preexisting;

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
        // Migrate to V37 first, add a property, then apply V38: the backfill
        // must give it a row, switched on, with today's behaviour.
        flyway("37").migrate();
        jdbi = Jdbi.create(dbUrl).installPlugin(new SqlObjectPlugin());
        preexisting = jdbi.withHandle(h -> h.createQuery("""
                        INSERT INTO merchants (slug, email, business_name, onboarding_state)
                        VALUES ('pre-v38', 'pre@inn.test', 'Old Inn', 'active') RETURNING id""")
                .mapTo(UUID.class).one());
        flyway(null).migrate();
    }

    private static Flyway flyway(String target) {
        var config = Flyway.configure().dataSource(dbUrl, null, null).locations("classpath:db/migration")
                .javaMigrations(new V30__Encrypt_pms_connection_tokens(TokenCipher.development()));
        if (target != null) config.target(target);
        return config.load();
    }

    @AfterAll
    static void dropDatabase() throws Exception {
        if (dbUrl == null) return;
        try (Connection admin = DriverManager.getConnection(ADMIN_URL); Statement st = admin.createStatement()) {
            st.execute("DROP DATABASE IF EXISTS " + DB_NAME + " WITH (FORCE)");
        }
    }

    private static BlissSettingsService service(boolean holdModeFeature) {
        FeaturesConfig features = new FeaturesConfig();
        features.setHoldMode(holdModeFeature);
        return new BlissSettingsService(jdbi.onDemand(BlissSettingsDao.class),
                jdbi.onDemand(MerchantPlanRulesDao.class), jdbi.onDemand(MerchantFeeRateDao.class),
                jdbi.onDemand(MerchantMewsConnectionDao.class),
                jdbi.onDemand(com.bliss.b2b.persistence.BlissRateDao.class), features, CLOCK);
    }

    private static Merchant newMerchant(String pmsType) {
        UUID id = UUID.randomUUID();
        UUID merchantId = jdbi.withHandle(h -> h.createQuery("""
                        INSERT INTO merchants (slug, email, business_name, pms_type, currency, time_zone, locale)
                        VALUES (:slug, :email, 'Test Inn', :pms, 'GBP', 'Europe/London', 'en-GB')
                        RETURNING id""")
                .bind("slug", "s" + id.toString().substring(0, 8)).bind("email", id + "@inn.test")
                .bind("pms", pmsType).mapTo(UUID.class).one());
        return jdbi.onDemand(MerchantDao.class).findById(merchantId).orElseThrow();
    }

    /** A US property that finished Express onboarding, so it can hold payments. */
    private static Merchant holdReadyMerchant() {
        Merchant m = newMerchant("none");
        jdbi.useHandle(h -> h.createUpdate("""
                        UPDATE merchants SET currency = 'USD', stripe_connect_account_id = :acct,
                                             stripe_connect_status = 'charges_enabled'
                        WHERE id = :m""")
                .bind("acct", "acct_express_" + m.id().toString().substring(0, 8)).bind("m", m.id()).execute());
        return jdbi.onDemand(MerchantDao.class).findById(m.id()).orElseThrow();
    }

    private static Setting setting(SettingsView view, String key) {
        return view.settings().stream().filter(s -> s.key().equals(key)).findFirst().orElseThrow();
    }

    @Test
    void aPropertyThatConfiguredNothingHasEverySettingAtItsDefault() {
        SettingsView view = service(false).view(newMerchant("none"));

        assertThat(view.enabled()).isFalse();
        assertThat(setting(view, "payoutMode").value()).isEqualTo("pay_as_you_go");
        assertThat(setting(view, "payoutMode").source()).isEqualTo("default");
        assertThat(setting(view, "releasePolicy").display()).isEqualTo("When free cancellation ends");
        assertThat(setting(view, "chargebackBufferDays").value()).isEqualTo(3);
        assertThat(setting(view, "paymentSchedules").display())
                .isEqualTo("Every 2 weeks and monthly (monthly recommended)");
        assertThat(setting(view, "minLeadTimeWeeks").display()).isEqualTo("6 weeks or more before arrival");
        assertThat(setting(view, "finalPaymentDue").display()).isEqualTo("3 days before check-in");
        assertThat(setting(view, "retries").display()).isEqualTo("3 tries, 3 days apart");
        assertThat(setting(view, "afterRetries").display()).isEqualTo("Treat it as a cancellation");
        assertThat(setting(view, "refundPolicy").display()).isEqualTo("Full refund of what they've paid");
        assertThat(setting(view, "blissFee").display()).isEqualTo("5% of each plan");
        assertThat(setting(view, "blissFee").source()).isEqualTo("default");
        // On by default; a property without Mews has no folio to post to.
        assertThat(setting(view, "feeOnFolio").display()).isEqualTo("Not used without Mews");
        assertThat(setting(view, "currency").value()).isEqualTo("GBP");
        // Every setting has a plain-language display, and none uses an em dash.
        assertThat(view.settings()).allSatisfy(s -> {
            assertThat(s.display()).isNotBlank();
            assertThat(s.label() + s.help() + s.display()).doesNotContain("—");
        });
    }

    @Test
    void switchingBlissOnNeedsNoConfiguration_andKeepsTheFirstTime() {
        Merchant merchant = newMerchant("none");
        BlissSettingsService service = service(false);

        SettingsView first = service.enable(merchant);
        SettingsView again = service.enable(merchant);

        assertThat(first.enabled()).isTrue();
        assertThat(first.enabledAt()).isEqualTo(CLOCK.instant());
        assertThat(again.enabledAt()).isEqualTo(first.enabledAt());
        assertThat(setting(again, "payoutMode").value()).isEqualTo("pay_as_you_go");
    }

    @Test
    void theSettingsBlissOwnsCanBeChanged() {
        Merchant merchant = newMerchant("none");

        SettingsView view = service(false).update(merchant, null, "check_in", 7);

        assertThat(setting(view, "releasePolicy").value()).isEqualTo("check_in");
        assertThat(setting(view, "releasePolicy").source()).isEqualTo("hotel");
        assertThat(setting(view, "chargebackBufferDays").display()).isEqualTo("7 days");
        assertThat(setting(view, "payoutMode").value()).as("left as it was").isEqualTo("pay_as_you_go");
    }

    @Test
    void badValuesAreRefused() {
        Merchant merchant = newMerchant("none");

        assertThatThrownBy(() -> service(false).update(merchant, "sometimes", null, null))
                .isInstanceOf(SettingsException.class)
                .extracting(e -> ((SettingsException) e).code()).isEqualTo("invalid_setting");
        assertThatThrownBy(() -> service(false).update(merchant, null, null, 31))
                .extracting(e -> ((SettingsException) e).code()).isEqualTo("invalid_setting");
    }

    @Test
    void holdModeStaysUnavailableUntilItsFeatureIsSwitchedOn() {
        Merchant merchant = holdReadyMerchant();

        assertThatThrownBy(() -> service(false).update(merchant, "hold", null, null))
                .extracting(e -> ((SettingsException) e).code()).isEqualTo("hold_mode_unavailable");
        assertThat(setting(service(false).view(merchant), "payoutMode").options())
                .anySatisfy(o -> {
                    assertThat(o.value()).isEqualTo("hold");
                    assertThat(o.available()).isFalse();
                    assertThat(o.note()).isEqualTo("Coming soon");
                });

        SettingsView view = service(true).update(merchant, "hold", null, null);
        assertThat(setting(view, "payoutMode").value()).isEqualTo("hold");
    }

    @Test
    void holdModeNeedsAFinishedExpressAccountAndUsDollars() {
        Merchant noExpress = newMerchant("none");
        jdbi.useHandle(h -> h.execute("UPDATE merchants SET currency = 'USD' WHERE id = ?", noExpress.id()));
        Merchant usdNoExpress = jdbi.onDemand(MerchantDao.class).findById(noExpress.id()).orElseThrow();
        assertThatThrownBy(() -> service(true).update(usdNoExpress, "hold", null, null))
                .extracting(e -> ((SettingsException) e).code()).isEqualTo("express_onboarding_required");

        Merchant pounds = holdReadyMerchant();
        jdbi.useHandle(h -> h.execute("UPDATE merchants SET currency = 'GBP' WHERE id = ?", pounds.id()));
        Merchant gbp = jdbi.onDemand(MerchantDao.class).findById(pounds.id()).orElseThrow();
        assertThatThrownBy(() -> service(true).update(gbp, "hold", null, null))
                .extracting(e -> ((SettingsException) e).code()).isEqualTo("hold_mode_us_only");
    }

    @Test
    void switchingToHoldModeSetsStripeToDebitNegativeBalances_andRefusesIfStripeCannot() {
        Merchant merchant = holdReadyMerchant();
        java.util.List<String> prepared = new java.util.ArrayList<>();

        assertThatThrownBy(() -> service(true).withHoldAccountSetup(acct -> {
                    throw new IllegalStateException("stripe down");
                }).update(merchant, "hold", null, null))
                .extracting(e -> ((SettingsException) e).code()).isEqualTo("stripe_setup_failed");
        assertThat(setting(service(true).view(merchant), "payoutMode").value()).isEqualTo("pay_as_you_go");

        service(true).withHoldAccountSetup(prepared::add).update(merchant, "hold", null, null);
        assertThat(prepared).containsExactly(merchant.stripeConnectAccountId());
        assertThat(setting(service(true).view(merchant), "payoutMode").value()).isEqualTo("hold");
    }

    @Test
    void theLedgerPaymentTypeIsAHotelSettingThatStartsUnchosen() {
        Merchant merchant = newMerchant("mews");

        assertThat(setting(service(false).view(merchant), "ledgerPaymentType").display()).isEqualTo("Not chosen yet");
        SettingsView view = service(false).setLedgerPaymentType(merchant, "Unspecified");
        assertThat(setting(view, "ledgerPaymentType").value()).isEqualTo("Unspecified");
        assertThat(setting(view, "ledgerPaymentType").source()).isEqualTo("hotel");
        assertThatThrownBy(() -> service(false).setLedgerPaymentType(merchant, "Cash; DROP"))
                .extracting(e -> ((SettingsException) e).code()).isEqualTo("invalid_setting");
    }

    @Test
    void aMewsPropertysRatesAndDepositComeFromMews() {
        Merchant merchant = newMerchant("mews");
        jdbi.useHandle(h -> h.createUpdate("""
                        INSERT INTO merchant_mews_connections (merchant_id, platform_url, client_token, access_token,
                            enterprise_id, enterprise_name, currency, validated_at, bliss_monthly_rate_id)
                        VALUES (:m, 'https://api.mews-demo.com', 'v1:ct', 'v1:at', 'ent', 'Test Inn', 'GBP', now(),
                                'rate-monthly')""")
                .bind("m", merchant.id()).execute());

        SettingsView view = service(false).view(merchant);

        assertThat(setting(view, "blissRates").display()).isEqualTo("Monthly");
        assertThat(setting(view, "blissRates").source()).isEqualTo("mews");
        assertThat(setting(view, "deposit").display()).isEqualTo("Whatever your Bliss rate charges at booking");
        assertThat(setting(view, "deposit").editable()).isFalse();
        assertThat(setting(view, "currency").source()).isEqualTo("mews");
    }

    @Test
    void newBookingsRecordThePayoutModeTheyWereMadeUnder() {
        Merchant payAsYouGo = newMerchant("none");
        Merchant holding = holdReadyMerchant();
        service(true).update(holding, "hold", null, null);
        BookingDao bookings = jdbi.onDemand(BookingDao.class);

        for (Merchant m : new Merchant[] {payAsYouGo, holding}) {
            bookings.insert(m.id(), "tok-" + m.id().toString().substring(0, 12), "Stay", null, 50_000,
                    LocalDate.of(2027, 3, 1), null, null, null, null, null, "merchant_initiated");
        }

        assertThat(payoutModeOf(payAsYouGo)).isEqualTo("pay_as_you_go");
        assertThat(payoutModeOf(holding)).isEqualTo("hold");
    }

    @Test
    void propertiesFromBeforeV38GetARowOfDefaults_switchedOnIfSetUp() {
        assertThat(jdbi.onDemand(BlissSettingsDao.class).find(preexisting)).hasValueSatisfying(s -> {
            assertThat(s.payoutMode().wire()).isEqualTo("pay_as_you_go");
            assertThat(s.enabled()).isTrue();
        });
    }

    private static String payoutModeOf(Merchant merchant) {
        return jdbi.withHandle(h -> h.createQuery("SELECT payout_mode FROM bookings WHERE merchant_id = :m")
                .bind("m", merchant.id()).mapTo(String.class).one());
    }
}
