package com.bliss.b2b.cli;

import com.bliss.b2b.BlissConfiguration;
import com.bliss.b2b.persistence.DatabaseUrlResolver;
import io.dropwizard.core.cli.ConfiguredCommand;
import io.dropwizard.core.setup.Bootstrap;
import java.util.Optional;
import net.sourceforge.argparse4j.inf.Namespace;
import org.jdbi.v3.core.Jdbi;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Creates the Marbrook House demo merchant. Idempotent: existence is checked by
 * slug, and a second run is a no-op.
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
 * <p>Scope is the merchant plus its plan rules — the state the dashboard needs
 * to render. Bookings are not seeded; the {@code seed-*} bookings in the local
 * database were created ad hoc and have no committed source to replicate.
 */
public class SeedDemoCommand extends ConfiguredCommand<BlissConfiguration> {

    private static final Logger log = LoggerFactory.getLogger(SeedDemoCommand.class);

    // Fixed identifiers, matching the local demo merchant so the seeded row is a
    // faithful copy and re-runs stay deterministic.
    private static final String MERCHANT_ID = "9b54a488-b308-4a6d-91cc-38983ff982ac";
    private static final String PLAN_RULES_ID = "d7f3e4c4-f3eb-44bd-9540-d696acd28326";
    private static final String SLUG = "j9l29fke";
    private static final String EMAIL = "demo@marbrookhouse.com";

    /**
     * Synthetic Connect account, mirroring what the demo-complete onboarding
     * path mints. Leaving Stripe blank keeps the platform in demo mode, and
     * charges_enabled against an acct_demo_* id is what lets the dashboard
     * render fully without live keys.
     */
    private static final String STRIPE_ACCOUNT_ID = "acct_demo_8d0f801440de";

    private static final String INSERT_MERCHANT = """
            INSERT INTO merchants (
                id, slug, email, business_name, business_type,
                address_line1, address_city, address_state, address_zip, address_country,
                stripe_connect_account_id, stripe_connect_status,
                status, email_verified_at
            ) VALUES (
                CAST(:id AS uuid), :slug, :email, 'Marbrook House', 'hotel',
                '118 Greenwich Avenue', 'Hudson', 'NY', '12534', 'US',
                :stripeAccountId, 'charges_enabled',
                'active', now()
            )
            ON CONFLICT (slug) DO NOTHING
            """;

    /**
     * Only the settings that differ from the schema defaults are set explicitly;
     * the rest (6-week lead time, both frequencies, no deposit, 3 retries every
     * 3 days, treat-as-cancellation, no discount) already match Marbrook.
     *
     * <p>payment_due_custom_months is a stale name: V15 widened its range and
     * the value now means days, so 2 here is 2 days before check-in.
     */
    private static final String INSERT_PLAN_RULES = """
            INSERT INTO merchant_plan_rules (
                id, merchant_id,
                min_lead_time_weeks, allowed_frequencies,
                deposit_required, discount_basis_points,
                refund_policy,
                payment_due_policy, payment_due_custom_months,
                retry_attempts, retry_spacing_days,
                after_retries_action
            ) VALUES (
                CAST(:id AS uuid), CAST(:merchantId AS uuid),
                6, 'both',
                FALSE, 0,
                'credit_only',
                'custom_months', 2,
                3, 3,
                'treat_as_cancellation'
            )
            ON CONFLICT (merchant_id) DO NOTHING
            """;

    public SeedDemoCommand() {
        super("seed-demo", "Idempotently create the Marbrook House demo merchant");
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

        // No connection pool: this is a single short-lived process doing a
        // handful of statements.
        Jdbi jdbi = Jdbi.create(db.getUrl(), db.getUser(), db.getPassword());

        jdbi.useTransaction(handle -> {
            Optional<String> existing = handle
                    .createQuery("SELECT id::text FROM merchants WHERE slug = :slug")
                    .bind("slug", SLUG)
                    .mapTo(String.class)
                    .findOne();

            if (existing.isPresent()) {
                log.info("Demo merchant '{}' already exists (id={}); nothing to do", SLUG, existing.get());
                return;
            }

            int merchants = handle.createUpdate(INSERT_MERCHANT)
                    .bind("id", MERCHANT_ID)
                    .bind("slug", SLUG)
                    .bind("email", EMAIL)
                    .bind("stripeAccountId", STRIPE_ACCOUNT_ID)
                    .execute();

            int planRules = handle.createUpdate(INSERT_PLAN_RULES)
                    .bind("id", PLAN_RULES_ID)
                    .bind("merchantId", MERCHANT_ID)
                    .execute();

            log.info("Seeded demo merchant '{}' ({}) id={} stripe={} — {} merchant row, {} plan rules row",
                    SLUG, EMAIL, MERCHANT_ID, STRIPE_ACCOUNT_ID, merchants, planRules);
        });

        log.info("seed-demo complete. Sign in at the merchant dashboard as {}", EMAIL);
    }
}
