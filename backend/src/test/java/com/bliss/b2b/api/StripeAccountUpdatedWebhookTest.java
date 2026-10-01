package com.bliss.b2b.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import com.bliss.b2b.BlissConfiguration.AppConfig;
import com.bliss.b2b.BlissConfiguration.StripeConfig;
import com.bliss.b2b.integration.StripeConnectService;
import com.bliss.b2b.persistence.MerchantCloudbedsConnectionDao;
import com.bliss.b2b.persistence.MerchantDao;
import com.bliss.b2b.persistence.MerchantMewsConnectionDao;
import com.bliss.b2b.persistence.MerchantStripeConnectionDao;
import com.bliss.b2b.persistence.MewsLinkingDao;
import com.bliss.b2b.persistence.migration.V30__Encrypt_pms_connection_tokens;
import com.bliss.b2b.security.TokenCipher;
import com.bliss.b2b.service.PropertyOnboardingService;
import com.stripe.exception.ApiConnectionException;
import com.stripe.exception.StripeException;
import com.stripe.model.Account;
import com.stripe.model.Event;
import com.stripe.net.ApiResource;
import jakarta.ws.rs.core.Response;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.Statement;
import java.time.Clock;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.jdbi.v3.core.Jdbi;
import org.jdbi.v3.sqlobject.SqlObjectPlugin;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

/**
 * {@code account.updated} webhooks are applied. They used to be acknowledged
 * with a 200 and dropped whenever Stripe sent the event under an API version
 * other than the library's pinned one, because the event's object then fails
 * to deserialize. The handler now reads the account id from the raw event and
 * applies the live account. Throwaway Postgres; SKIPS without one.
 */
class StripeAccountUpdatedWebhookTest {

    private static final String ADMIN_URL = System.getenv().getOrDefault(
            "BLISS_TEST_DB_URL", "jdbc:postgresql://localhost:5432/bliss");
    private static final String DB_NAME =
            "bliss_webhooktest_" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);

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

    /** Stripe as the webhook sees it: a given event, and accounts read back by id. */
    private static final class FakeStripe extends StripeConnectService {
        final Map<String, Account> accounts = new HashMap<>();
        Event event;

        FakeStripe() {
            super(new StripeConfig());
        }

        @Override public boolean isConfigured() {
            return true;
        }

        @Override public Event parseWebhookEvent(String payload, String signatureHeader) {
            return event;
        }

        @Override public Account fetchAccount(String id) throws StripeException {
            Account account = accounts.get(id);
            if (account == null) {
                throw new ApiConnectionException("Stripe unreachable");
            }
            return account;
        }
    }

    private static Event accountUpdated(String accountId, String apiVersion) {
        return ApiResource.GSON.fromJson("""
                {"id": "evt_%s", "object": "event", "type": "account.updated", "api_version": "%s",
                 "data": {"object": {"id": "%s", "object": "account", "charges_enabled": false}}}
                """.formatted(accountId, apiVersion, accountId), Event.class);
    }

    private static Account liveAccount(String accountId) {
        return ApiResource.GSON.fromJson("""
                {"id": "%s", "object": "account", "charges_enabled": true, "payouts_enabled": true,
                 "details_submitted": true, "default_currency": "usd",
                 "settings": {"dashboard": {"timezone": "America/Chicago"}},
                 "requirements": {"disabled_reason": null}}
                """.formatted(accountId), Account.class);
    }

    private StripeConnectResource resource(FakeStripe stripe) {
        MerchantDao merchants = jdbi.onDemand(MerchantDao.class);
        MerchantStripeConnectionDao connections = jdbi.onDemand(MerchantStripeConnectionDao.class);
        PropertyOnboardingService onboarding = new PropertyOnboardingService(
                merchants, jdbi.onDemand(MerchantMewsConnectionDao.class), connections,
                jdbi.onDemand(MerchantCloudbedsConnectionDao.class), null, jdbi.onDemand(MewsLinkingDao.class),
                Clock.systemUTC());
        return new StripeConnectResource(stripe, merchants, message -> { }, new AppConfig(), connections,
                onboarding, Clock.systemUTC());
    }

    private static String id(String prefix) {
        return prefix + UUID.randomUUID().toString().replace("-", "").substring(0, 10);
    }

    private static UUID insertMerchant(String pmsType, String expressAccount) {
        UUID id = UUID.randomUUID();
        return jdbi.withHandle(h -> h.createQuery("""
                        INSERT INTO merchants (slug, email, business_name, pms_type, onboarding_state,
                                               stripe_connect_account_id, stripe_connect_status)
                        VALUES (:slug, :email, 'Test Inn', :pms, 'pms_selected', :acct, 'in_progress')
                        RETURNING id""")
                .bind("slug", "w" + id.toString().substring(0, 8)).bind("email", id + "@inn.test")
                .bind("pms", pmsType).bind("acct", expressAccount)
                .mapTo(UUID.class).one());
    }

    @Test
    void anEventFromAnotherApiVersionIsAppliedFromTheLiveAccount() {
        String account = id("acct_");
        UUID merchant = insertMerchant("none", account);
        FakeStripe stripe = new FakeStripe();
        stripe.event = accountUpdated(account, "2020-08-27");
        stripe.accounts.put(account, liveAccount(account));

        // The cause of the bug: this event's object does not deserialize.
        assertThat(stripe.event.getDataObjectDeserializer().getObject()).isEmpty();

        Response res = resource(stripe).webhook("sig", "{}");

        assertThat(res.getStatus()).isEqualTo(200);
        Map<String, Object> row = jdbi.withHandle(h -> h.createQuery(
                        "SELECT stripe_connect_status, currency, time_zone FROM merchants WHERE id = :m")
                .bind("m", merchant).mapToMap().one());
        assertThat(row).containsEntry("stripe_connect_status", "charges_enabled")
                .containsEntry("currency", "USD").containsEntry("time_zone", "America/Chicago");
    }

    @Test
    void aStandardConnectionIsUpdatedToo() {
        String account = id("acct_");
        UUID merchant = insertMerchant("stripe", null);
        jdbi.useHandle(h -> h.createUpdate("""
                        INSERT INTO merchant_stripe_connections (merchant_id, stripe_account_id, connect_status,
                                                                 charges_enabled)
                        VALUES (:m, :a, 'in_progress', FALSE)""")
                .bind("m", merchant).bind("a", account).execute());
        FakeStripe stripe = new FakeStripe();
        stripe.event = accountUpdated(account, "2020-08-27");
        stripe.accounts.put(account, liveAccount(account));

        Response res = resource(stripe).webhook("sig", "{}");

        assertThat(res.getStatus()).isEqualTo(200);
        Map<String, Object> row = jdbi.withHandle(h -> h.createQuery(
                        "SELECT connect_status, charges_enabled FROM merchant_stripe_connections WHERE merchant_id = :m")
                .bind("m", merchant).mapToMap().one());
        assertThat(row).containsEntry("connect_status", "charges_enabled").containsEntry("charges_enabled", true);
    }

    @Test
    void whenTheAccountCannotBeReadStripeIsAskedToRetry() {
        String account = id("acct_");
        UUID merchant = insertMerchant("none", account);
        FakeStripe stripe = new FakeStripe();
        stripe.event = accountUpdated(account, "2020-08-27");

        Response res = resource(stripe).webhook("sig", "{}");

        assertThat(res.getStatus()).isEqualTo(500);
        String status = jdbi.withHandle(h -> h.createQuery(
                        "SELECT stripe_connect_status FROM merchants WHERE id = :m")
                .bind("m", merchant).mapTo(String.class).one());
        assertThat(status).isEqualTo("in_progress");
    }

    @Test
    void theAccountIdIsReadWhateverTheEventsApiVersion() {
        assertThat(StripeConnectResource.accountIdOf(accountUpdated("acct_old", "2019-02-19"))).isEqualTo("acct_old");
        assertThat(StripeConnectResource.accountIdOf(accountUpdated("acct_new", "2026-04-22.dahlia")))
                .isEqualTo("acct_new");
    }
}
