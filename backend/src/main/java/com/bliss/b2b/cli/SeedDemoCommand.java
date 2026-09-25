package com.bliss.b2b.cli;

import com.bliss.b2b.BlissConfiguration;
import com.bliss.b2b.persistence.DatabaseUrlResolver;
import com.bliss.b2b.security.TokenCipher;
import com.bliss.b2b.security.TokenCipher.Field;
import io.dropwizard.core.cli.ConfiguredCommand;
import io.dropwizard.core.setup.Bootstrap;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.sql.Statement;
import java.util.Optional;
import java.util.UUID;
import net.sourceforge.argparse4j.inf.Namespace;
import org.jdbi.v3.core.Handle;
import org.jdbi.v3.core.Jdbi;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Creates the Marbrook House demo merchant and its five fixture bookings, so a
 * fresh production database can be brought to a demoable state.
 *
 * <p>Idempotent: every statement in the script is ON CONFLICT DO NOTHING, keyed
 * on the natural identifier (merchant slug, booking token, customer email), so a
 * re-run adds only what is missing and never duplicates. It is also safe to run
 * against a database seeded by an earlier version of this command — anything
 * added since simply lands.
 *
 * <p>A command rather than a Dropwizard task, for two reasons. Tasks are served
 * from the admin connector, and Heroku routes only {@code $PORT} — the admin
 * port is unreachable from outside the dyno, so {@code POST /tasks/seed-demo}
 * could never be called. And a task needs a running app, while a one-off dyno
 * is a fresh process. A command is what {@code heroku run} can actually drive:
 *
 * <pre>
 *   heroku run "java -jar backend/target/bliss-b2b-backend.jar \
 *       seed-demo backend/src/main/resources/config.yml" -a bliss-b2b-api
 * </pre>
 *
 * <p>Deliberately not a Flyway migration: seeding demo data is not schema, and
 * as a migration it would run implicitly on every boot in every environment.
 * This only ever runs when a human invokes it.
 *
 * @see /demo-seed-marbrook.sql for the data itself
 */
public class SeedDemoCommand extends ConfiguredCommand<BlissConfiguration> {

    private static final Logger log = LoggerFactory.getLogger(SeedDemoCommand.class);

    private static final String SCRIPT = "/demo-seed-marbrook.sql";
    private static final String SLUG = "j9l29fke";
    // The PUBLIC demo address, deliberately not a Marbrook one: this account is
    // the open funnel anyone can sign into, while demo@marbrookhouse.com is the
    // real Marbrook portal and is master-password-only.
    private static final String EMAIL = "demo@bliss-payments.com";

    /** Marbrook House, the Mews-rail demo property. */
    private static final UUID MARBROOK_HOUSE_ID = UUID.fromString("9b54a488-b308-4a6d-91cc-38983ff982ac");
    /** Marbrook Grand, the Cloudbeds-rail demo property. */
    private static final UUID MARBROOK_GRAND_ID = UUID.fromString("6d3ae2b1-0000-4000-8000-000000000002");

    // Public Mews demo credentials for the shared "API Hotel (Net Pricing)"
    // demo enterprise: USD, America/New_York. docs.mews.com publishes both
    // tokens and states the demo environment is completely public and must
    // never hold real data, so they are safe to seed. Chosen over the Gross
    // pricing UK demo because that one prices in GBP, which Marbrook's USD
    // connection would refuse as a currency mismatch.
    private static final String MEWS_DEMO_CLIENT_TOKEN =
            "E0D439EE522F44368DC78E1BFB03710C-D24FB11DBE31D4621C4817E028D9E1D";
    private static final String MEWS_DEMO_ACCESS_TOKEN =
            "4D6C7ABE0E6A4681B0AFB16900AE5D86-DF50CBC89E1D4FF5859DDF021649ED5";
    private static final String MEWS_DEMO_ENTERPRISE_ID = "c65ea6e9-2340-42f4-9136-ab3a00b6da22";
    private static final String MEWS_DEMO_ENTERPRISE_NAME = "API Hotel (Net Pricing) DO NOT CHANGE NAME";
    /** The Gross pricing UK demo enterprise earlier seeds pointed at. */
    private static final String OLD_GROSS_UK_ENTERPRISE_ID = "851df8c8-90f2-4c4a-8e01-a4fc46b25178";
    // Booking setup on the Net Pricing demo: "Macrotech Service" (check-in 15:00,
    // check-out 12:00) and its public "Fully Flexible" rate. The demo has no
    // private rate to use; a real property books a private one.
    private static final String MEWS_DEMO_SERVICE_ID = "0738dd52-f2d9-4e6e-969d-b44500d86ae9";
    private static final String MEWS_DEMO_RATE_ID = "1072fa42-fb72-41c9-b606-b44500d86afd";
    private static final String MEWS_DEMO_ADULT_AGE_CATEGORY_ID = "c269deb1-9f1d-44bc-9857-b44500d86af9";
    private static final String MEWS_DEMO_TIME_ZONE = "America/New_York";


    public SeedDemoCommand() {
        super("seed-demo", "Idempotently create the Marbrook House demo merchant and fixture bookings");
    }

    @Override
    protected void run(
            Bootstrap<BlissConfiguration> bootstrap,
            Namespace namespace,
            BlissConfiguration configuration
    ) throws Exception {
        // BlissApplication.run() never executes for a command, so the platform
        // DATABASE_URL has to be resolved here too. Without this the command
        // would target the local-dev default and appear to succeed against
        // nothing.
        DatabaseUrlResolver.applyFromEnvironment(configuration.getDatabase());
        BlissConfiguration.DatabaseConfig db = configuration.getDatabase();

        String script = readScript();
        TokenCipher cipher = TokenCipher.fromConfig(
                configuration.getTokenEncryptionKey(), configuration.isProduction());

        // No connection pool: this is a single short-lived process running one
        // script.
        Jdbi jdbi = Jdbi.create(db.getUrl(), db.getUser(), db.getPassword());

        jdbi.useTransaction(handle -> {
            Optional<String> existing = findMerchantId(handle);
            existing.ifPresent(id ->
                    log.info("Demo merchant '{}' already present (id={}); filling in anything missing", SLUG, id));

            Counts before = Counts.read(handle);
            execute(handle, script);
            seedPmsConnections(handle, cipher);
            Counts after = Counts.read(handle);

            if (after.equals(before)) {
                log.info("Nothing to do — demo data already complete ({})", after);
            } else {
                log.info("Seeded demo data. Before: {} | after: {}", before, after);
            }
        });

        log.info("seed-demo complete. Merchant dashboard: sign in as {}. Consumer portal: sign in as any "
                + "of the +seed@example.com addresses (demo auth accepts any password).", EMAIL);
    }

    /**
     * Runs the whole script through one JDBC statement rather than Jdbi's script
     * splitter: the SQL is static, has no bind parameters, and contains
     * colon-bearing timestamp literals that a parameter-parsing path could
     * misread.
     */
    private static void execute(Handle handle, String script) {
        try (Statement statement = handle.getConnection().createStatement()) {
            statement.execute(script);
        } catch (Exception e) {
            throw new IllegalStateException("Failed executing " + SCRIPT + ": " + e.getMessage(), e);
        }
    }

    /**
     * The two demo PMS connections, which the SQL script cannot insert because
     * their tokens are sealed with the application's key (V30). Same rules as
     * the script: ON CONFLICT DO NOTHING, so an existing row is left alone.
     */
    private static void seedPmsConnections(Handle handle, TokenCipher cipher) {
        String clientToken = cipher.encrypt(Field.MEWS_CLIENT_TOKEN, MARBROOK_HOUSE_ID, MEWS_DEMO_CLIENT_TOKEN);
        String accessToken = cipher.encrypt(Field.MEWS_ACCESS_TOKEN, MARBROOK_HOUSE_ID, MEWS_DEMO_ACCESS_TOKEN);
        handle.createUpdate("""
                INSERT INTO merchant_mews_connections (
                    merchant_id, platform_url, client_token, access_token,
                    enterprise_id, enterprise_name, currency, validated_at,
                    service_id, bliss_rate_id, adult_age_category_id, time_zone
                ) VALUES (
                    :merchantId, 'https://api.mews-demo.com', :clientToken, :accessToken,
                    :enterpriseId, :enterpriseName, 'USD', now(),
                    :serviceId, :rateId, :adultId, :timeZone
                )
                ON CONFLICT (merchant_id) DO NOTHING
                """)
                .bind("merchantId", MARBROOK_HOUSE_ID)
                .bind("clientToken", clientToken)
                .bind("accessToken", accessToken)
                .bind("enterpriseId", MEWS_DEMO_ENTERPRISE_ID)
                .bind("enterpriseName", MEWS_DEMO_ENTERPRISE_NAME)
                .bind("serviceId", MEWS_DEMO_SERVICE_ID)
                .bind("rateId", MEWS_DEMO_RATE_ID)
                .bind("adultId", MEWS_DEMO_ADULT_AGE_CATEGORY_ID)
                .bind("timeZone", MEWS_DEMO_TIME_ZONE)
                .execute();

        // Databases seeded before the move still point Marbrook House at the
        // Gross pricing UK enterprise with no booking setup. Repoint them.
        // Scoped to that enterprise id, so a connection someone set up by hand
        // is left alone. Idempotent: once moved, nothing matches. Mews customer
        // and card ids from the old enterprise do not carry over, so demo plans
        // started there will not charge on the new one.
        int moved = handle.createUpdate("""
                UPDATE merchant_mews_connections
                SET client_token = :clientToken,
                    access_token = :accessToken,
                    enterprise_id = :enterpriseId,
                    enterprise_name = :enterpriseName,
                    currency = 'USD',
                    validated_at = now(),
                    service_id = :serviceId,
                    bliss_rate_id = :rateId,
                    adult_age_category_id = :adultId,
                    time_zone = :timeZone
                WHERE merchant_id = :merchantId AND enterprise_id = :oldEnterpriseId
                """)
                .bind("merchantId", MARBROOK_HOUSE_ID)
                .bind("clientToken", clientToken)
                .bind("accessToken", accessToken)
                .bind("enterpriseId", MEWS_DEMO_ENTERPRISE_ID)
                .bind("enterpriseName", MEWS_DEMO_ENTERPRISE_NAME)
                .bind("serviceId", MEWS_DEMO_SERVICE_ID)
                .bind("rateId", MEWS_DEMO_RATE_ID)
                .bind("adultId", MEWS_DEMO_ADULT_AGE_CATEGORY_ID)
                .bind("timeZone", MEWS_DEMO_TIME_ZONE)
                .bind("oldEnterpriseId", OLD_GROSS_UK_ENTERPRISE_ID)
                .execute();
        if (moved > 0) {
            log.info("Moved Marbrook House's Mews connection to the Net Pricing demo enterprise");
        }

        // Synthetic Cloudbeds tokens: no Cloudbeds object backs these. Expiry is
        // relative to seed time so re-seeding never yields an expired connection.
        handle.createUpdate("""
                INSERT INTO merchant_cloudbeds_connections (
                    merchant_id, property_id, property_name, currency,
                    access_token, refresh_token, access_token_expires_at,
                    status, connected_at
                ) VALUES (
                    :merchantId, 'cb_demo_property_318842', 'Marbrook Grand', 'USD',
                    :accessToken, :refreshToken, now() + interval '365 days',
                    'connected', now()
                )
                ON CONFLICT (merchant_id) DO NOTHING
                """)
                .bind("merchantId", MARBROOK_GRAND_ID)
                .bind("accessToken", cipher.encrypt(
                        Field.CLOUDBEDS_ACCESS_TOKEN, MARBROOK_GRAND_ID, "cb_seed_access_token_marbrook_grand"))
                .bind("refreshToken", cipher.encrypt(
                        Field.CLOUDBEDS_REFRESH_TOKEN, MARBROOK_GRAND_ID, "cb_seed_refresh_token_marbrook_grand"))
                .execute();
    }

    private static Optional<String> findMerchantId(Handle handle) {
        return handle.createQuery("SELECT id::text FROM merchants WHERE slug = :slug")
                .bind("slug", SLUG)
                .mapTo(String.class)
                .findOne();
    }

    private String readScript() throws IOException {
        try (InputStream in = getClass().getResourceAsStream(SCRIPT)) {
            if (in == null) {
                throw new IllegalStateException(SCRIPT + " not found on the classpath");
            }
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        }
    }

    /** Row counts scoped to the demo merchant, used to report what the run changed. */
    private record Counts(int merchants, int planRules, int customers, int bookings, int plans, int schedule) {

        private static final String MERCHANT = "(SELECT id FROM merchants WHERE slug = 'j9l29fke')";

        static Counts read(Handle handle) {
            return new Counts(
                    count(handle, "SELECT count(*) FROM merchants WHERE slug = 'j9l29fke'"),
                    count(handle, "SELECT count(*) FROM merchant_plan_rules WHERE merchant_id = " + MERCHANT),
                    count(handle, "SELECT count(*) FROM customers WHERE email LIKE '%+seed@example.com'"),
                    count(handle, "SELECT count(*) FROM bookings WHERE merchant_id = " + MERCHANT),
                    count(handle, "SELECT count(*) FROM payment_plans WHERE booking_id IN "
                            + "(SELECT id FROM bookings WHERE merchant_id = " + MERCHANT + ")"),
                    count(handle, "SELECT count(*) FROM payment_schedule WHERE payment_plan_id IN "
                            + "(SELECT id FROM payment_plans WHERE booking_id IN "
                            + "(SELECT id FROM bookings WHERE merchant_id = " + MERCHANT + "))"));
        }

        private static int count(Handle handle, String sql) {
            return handle.createQuery(sql).mapTo(Integer.class).one();
        }

        @Override
        public String toString() {
            return String.format(
                    "merchants=%d planRules=%d customers=%d bookings=%d plans=%d scheduleRows=%d",
                    merchants, planRules, customers, bookings, plans, schedule);
        }
    }
}
