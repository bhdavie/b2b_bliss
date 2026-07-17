package com.bliss.b2b.cli;

import com.bliss.b2b.BlissConfiguration;
import com.bliss.b2b.persistence.DatabaseUrlResolver;
import io.dropwizard.core.cli.ConfiguredCommand;
import io.dropwizard.core.setup.Bootstrap;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.sql.Statement;
import java.util.Optional;
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
    private static final String EMAIL = "demo@marbrookhouse.com";

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

        // No connection pool: this is a single short-lived process running one
        // script.
        Jdbi jdbi = Jdbi.create(db.getUrl(), db.getUser(), db.getPassword());

        jdbi.useTransaction(handle -> {
            Optional<String> existing = findMerchantId(handle);
            existing.ifPresent(id ->
                    log.info("Demo merchant '{}' already present (id={}); filling in anything missing", SLUG, id));

            Counts before = Counts.read(handle);
            execute(handle, script);
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
