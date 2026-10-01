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
import net.sourceforge.argparse4j.impl.Arguments;
import net.sourceforge.argparse4j.inf.Namespace;
import net.sourceforge.argparse4j.inf.Subparser;
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

    // Public Mews demo credentials for the shared "API Hotel Gross Pricing"
    // demo enterprise (GBP, Europe/Budapest). docs.mews.com publishes both
    // tokens and states the demo environment is completely public and must
    // never hold real data, so they are safe to seed.
    //
    // Gross UK rather than the Net Pricing demo because only Gross UK's Mews
    // Payments gateway charges stored cards online; on Net Pricing every
    // online charge fails, so Marbrook's checkout could never complete. The
    // property therefore trades in GBP, and its bookings are priced in pence.
    private static final String MEWS_DEMO_CLIENT_TOKEN =
            "E0D439EE522F44368DC78E1BFB03710C-D24FB11DBE31D4621C4817E028D9E1D";
    private static final String MEWS_DEMO_ACCESS_TOKEN =
            "C66EF7B239D24632943D115EDE9CB810-EA00F8FD8294692C940F6B5A8F9453D";
    private static final String MEWS_DEMO_ENTERPRISE_ID = "851df8c8-90f2-4c4a-8e01-a4fc46b25178";
    private static final String MEWS_DEMO_ENTERPRISE_NAME = "API Hotel Gross Pricing (DO NOT CHANGE THE NAME)";
    private static final String MEWS_DEMO_CURRENCY = "GBP";
    /** Gross UK's DefaultLanguageCode, as configuration/get reports it. */
    private static final String MEWS_DEMO_LOCALE = "en-GB";
    /** The Net Pricing demo enterprise an earlier version of this seed pointed at. */
    private static final String NET_PRICING_ENTERPRISE_ID = "c65ea6e9-2340-42f4-9136-ab3a00b6da22";
    // Booking setup on Gross UK: the "API HOTEL" service (check-in 15:00,
    // check-out 12:00, Budapest time) and its private "Siestify Pricing" rate,
    // the rate a real property's Bliss rate is modelled on. Charges on it
    // settle through the demo gateway (tested with Visa 4111 1111 1111 1111).
    private static final String MEWS_DEMO_SERVICE_ID = "66867ec0-62dc-4937-b04b-b37100ab60c1";
    private static final String MEWS_DEMO_RATE_ID = "221075f6-4d9c-408d-ba70-b37100ab60e7";
    private static final String MEWS_DEMO_ADULT_AGE_CATEGORY_ID = "344e58ae-2755-460a-b736-b37100ab60e2";
    // Bliss rates on Gross UK. The shared hotel is not ours to configure, so
    // two existing bookable rates on "API HOTEL" are designated rather than
    // created: "Fully Flexible" (the private rate above, whose charges settle)
    // stands for monthly plans and "DGET" (public) for every-2-weeks plans.
    // Neither carries a Bliss-style payment policy in Mews, so demo bookings
    // on them get their upfront charge from the test script, not from Mews.
    private static final String MEWS_DEMO_MONTHLY_RATE_ID = MEWS_DEMO_RATE_ID;
    private static final String MEWS_DEMO_BIWEEKLY_RATE_ID = "b98d890f-eddd-4afa-9d56-b48a009957f7";
    private static final String MEWS_DEMO_TIME_ZONE = "Europe/Budapest";


    /** Opt-in flag: designate Marbrook House's Bliss rates, which turns Mews linking on for it. */
    static final String LINK_BLISS_RATES = "link_bliss_rates";

    public SeedDemoCommand() {
        super("seed-demo", "Idempotently create the Marbrook House demo merchant and fixture bookings");
    }

    @Override
    public void configure(Subparser subparser) {
        super.configure(subparser);
        subparser.addArgument("--link-bliss-rates")
                .dest(LINK_BLISS_RATES)
                .action(Arguments.storeTrue())
                .help("Also designate Marbrook House's Bliss rates on the shared Gross UK demo, which starts "
                        + "linking (and later charging) every reservation anyone makes on those rates. "
                        + "Off by default.");
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
            seedPmsConnections(handle, cipher, Boolean.TRUE.equals(namespace.getBoolean(LINK_BLISS_RATES)));
            seedPropertyLocales(handle);
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
    /**
     * What each demo property trades in (V36). Marbrook House is on the Gross UK
     * Mews demo, so it takes that enterprise's GBP, Budapest zone and en-GB
     * language (as configuration/get reports them). The other demo properties
     * are US inns in Hudson, NY, including ones with no bookings yet (Marbrook
     * Lodge), which need a currency before they can take their first. Fills
     * each field only where it is unset, then gives demo bookings their
     * property's values in any field they lack.
     */
    private static void seedPropertyLocales(Handle handle) {
        // Fill whatever is missing, field by field, never overwriting a value
        // already set (V36 may have set a currency and left the rest empty).
        handle.createUpdate("""
                UPDATE merchants m
                SET currency  = COALESCE(m.currency, mc.currency),
                    time_zone = COALESCE(m.time_zone, mc.time_zone),
                    locale    = COALESCE(m.locale, mc.locale, :mewsLocale)
                FROM merchant_mews_connections mc
                WHERE mc.merchant_id = m.id AND m.id = :marbrookHouse
                  AND (m.currency IS NULL OR m.time_zone IS NULL OR m.locale IS NULL)
                """)
                .bind("marbrookHouse", MARBROOK_HOUSE_ID)
                .bind("mewsLocale", MEWS_DEMO_LOCALE)
                .execute();
        handle.createUpdate("""
                UPDATE merchant_mews_connections SET locale = :mewsLocale
                WHERE merchant_id = :marbrookHouse AND locale IS NULL
                """)
                .bind("marbrookHouse", MARBROOK_HOUSE_ID)
                .bind("mewsLocale", MEWS_DEMO_LOCALE)
                .execute();
        handle.createUpdate("""
                UPDATE merchants
                SET currency  = COALESCE(currency, 'USD'),
                    time_zone = COALESCE(time_zone, 'America/New_York'),
                    locale    = COALESCE(locale, 'en-US')
                WHERE id <> :marbrookHouse
                  AND address_city = 'Hudson' AND address_state = 'NY'
                  AND (currency IS NULL OR time_zone IS NULL OR locale IS NULL)
                """)
                .bind("marbrookHouse", MARBROOK_HOUSE_ID)
                .execute();
        // Demo bookings take whatever their property now has, again only into
        // empty fields. Scoped to the demo properties, so no real property's
        // bookings are touched by a seed.
        handle.createUpdate("""
                UPDATE bookings b
                SET currency  = COALESCE(b.currency, m.currency),
                    time_zone = COALESCE(b.time_zone, m.time_zone),
                    locale    = COALESCE(b.locale, m.locale)
                FROM merchants m
                WHERE m.id = b.merchant_id
                  AND (m.id = :marbrookHouse OR (m.address_city = 'Hudson' AND m.address_state = 'NY'))
                  AND (b.currency IS NULL OR b.time_zone IS NULL OR b.locale IS NULL)
                """)
                .bind("marbrookHouse", MARBROOK_HOUSE_ID)
                .execute();
    }

    private static void seedPmsConnections(Handle handle, TokenCipher cipher, boolean linkBlissRates) {
        String clientToken = cipher.encrypt(Field.MEWS_CLIENT_TOKEN, MARBROOK_HOUSE_ID, MEWS_DEMO_CLIENT_TOKEN);
        String accessToken = cipher.encrypt(Field.MEWS_ACCESS_TOKEN, MARBROOK_HOUSE_ID, MEWS_DEMO_ACCESS_TOKEN);
        handle.createUpdate("""
                INSERT INTO merchant_mews_connections (
                    merchant_id, platform_url, client_token, access_token,
                    enterprise_id, enterprise_name, currency, validated_at,
                    service_id, bliss_rate_id, adult_age_category_id, time_zone
                ) VALUES (
                    :merchantId, 'https://api.mews-demo.com', :clientToken, :accessToken,
                    :enterpriseId, :enterpriseName, :currency, now(),
                    :serviceId, :rateId, :adultId, :timeZone
                )
                ON CONFLICT (merchant_id) DO NOTHING
                """)
                .bind("merchantId", MARBROOK_HOUSE_ID)
                .bind("clientToken", clientToken)
                .bind("accessToken", accessToken)
                .bind("currency", MEWS_DEMO_CURRENCY)
                .bind("enterpriseId", MEWS_DEMO_ENTERPRISE_ID)
                .bind("enterpriseName", MEWS_DEMO_ENTERPRISE_NAME)
                .bind("serviceId", MEWS_DEMO_SERVICE_ID)
                .bind("rateId", MEWS_DEMO_RATE_ID)
                .bind("adultId", MEWS_DEMO_ADULT_AGE_CATEGORY_ID)
                .bind("timeZone", MEWS_DEMO_TIME_ZONE)
                .execute();

        // Bring older seeds in line: a connection on the Net Pricing demo, or an
        // original Gross UK one with no booking setup or the old USD label.
        // Scoped to those two enterprise ids, so a connection someone set up by
        // hand elsewhere is left alone. Idempotent: once in line, nothing
        // matches. Mews customer and card ids from another enterprise do not
        // carry over, so demo plans started there will not charge here.
        int moved = handle.createUpdate("""
                UPDATE merchant_mews_connections
                SET client_token = :clientToken,
                    access_token = :accessToken,
                    enterprise_id = :enterpriseId,
                    enterprise_name = :enterpriseName,
                    currency = :currency,
                    validated_at = now(),
                    service_id = :serviceId,
                    bliss_rate_id = :rateId,
                    adult_age_category_id = :adultId,
                    time_zone = :timeZone
                WHERE merchant_id = :merchantId
                  AND (enterprise_id = :netPricingEnterpriseId
                       OR (enterprise_id = :enterpriseId
                           AND (service_id IS NULL OR currency IS DISTINCT FROM :currency)))
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
                .bind("currency", MEWS_DEMO_CURRENCY)
                .bind("netPricingEnterpriseId", NET_PRICING_ENTERPRISE_ID)
                .execute();
        if (moved > 0) {
            log.info("Pointed Marbrook House's Mews connection at the Gross pricing UK demo enterprise (GBP)");
        }

        // Designate the Bliss rates only when asked (--link-bliss-rates). The
        // Gross UK demo is communal: once these are set, every reservation
        // anyone makes on these rates with an upfront charge becomes a Bliss
        // plan, and its installments are later charged. Linking starts from the
        // moment they are set, so older demo reservations never become plans.
        int designated = !linkBlissRates ? 0 : handle.createUpdate("""
                UPDATE merchant_mews_connections
                SET bliss_monthly_rate_id = :monthly,
                    bliss_biweekly_rate_id = :biweekly,
                    linked_through_utc = COALESCE(linked_through_utc, now())
                WHERE merchant_id = :merchantId
                  AND enterprise_id = :enterpriseId
                  AND bliss_monthly_rate_id IS NULL
                  AND bliss_biweekly_rate_id IS NULL
                """)
                .bind("merchantId", MARBROOK_HOUSE_ID)
                .bind("enterpriseId", MEWS_DEMO_ENTERPRISE_ID)
                .bind("monthly", MEWS_DEMO_MONTHLY_RATE_ID)
                .bind("biweekly", MEWS_DEMO_BIWEEKLY_RATE_ID)
                .execute();
        if (designated > 0) {
            log.info("Designated Marbrook House's Bliss rates on Gross UK (monthly {}, biweekly {})",
                    MEWS_DEMO_MONTHLY_RATE_ID, MEWS_DEMO_BIWEEKLY_RATE_ID);
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
