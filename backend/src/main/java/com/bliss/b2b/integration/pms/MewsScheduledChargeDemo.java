package com.bliss.b2b.integration.pms;

import com.bliss.b2b.BlissConfiguration.PmsConfig.MewsPmsConfig;
import com.bliss.b2b.service.InstallmentChargeService;
import com.bliss.b2b.service.InstallmentChargeService.JdbiLedger;
import com.bliss.b2b.service.InstallmentChargeService.PassResult;
import java.time.Clock;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.jdbi.v3.core.Jdbi;
import org.jdbi.v3.postgres.PostgresPlugin;
import org.jdbi.v3.sqlobject.SqlObjectPlugin;

/**
 * Live end-to-end demo of the Mews-rail installment charge pass, against the
 * local Postgres and the Mews demo API. It seeds a single Mews-rail plan with
 * one installment due today, runs {@link InstallmentChargeService#runDuePass},
 * and prints the row's status transition — showing the charge executing through
 * {@link MewsAdapter}, not Stripe.
 *
 * <p>Requires: local Postgres reachable (defaults below, or set DATABASE_URL /
 * PGUSER / PGPASSWORD), and a card already vaulted against the demo Mews
 * customer. If no card is vaulted, it prints how to vault one (via
 * {@link MewsAdapterDemo}) and exits cleanly.
 *
 * <pre>
 *   mvn -o compile \
 *     org.codehaus.mojo:exec-maven-plugin:3.5.0:java \
 *     -Dmain.class=com.bliss.b2b.integration.pms.MewsScheduledChargeDemo -pl backend
 * </pre>
 *
 * Deliberately a {@code main}, not a JUnit test: it needs a live DB and network.
 * The CI-safe proof of the routing/mapping is InstallmentChargeServiceTest.
 */
public final class MewsScheduledChargeDemo {

    private static final String DEMO_EMAIL = "bliss.pms.demo@example.com";

    // Fixed ids so reruns are idempotent (the plan + schedule are recreated).
    private static final UUID MERCHANT_ID = UUID.fromString("00000000-0000-4000-a000-0000000ab1e5");
    private static final UUID BOOKING_ID = UUID.fromString("00000000-0000-4000-a000-0000000ab1e6");

    private static final long INSTALLMENT_CENTS = 100; // 1.00 in the property currency

    private MewsScheduledChargeDemo() {
    }

    public static void main(String[] args) {
        MewsPmsConfig config = new MewsPmsConfig();
        MewsAdapter adapter = new MewsAdapter(config);

        System.out.println("== Mews scheduled-charge demo ==");

        // 1. Resolve the property currency and the demo customer + a vaulted card.
        PmsPropertyConfiguration cfg = adapter.getPropertyConfiguration();
        String currency = cfg.defaultCurrency() == null ? "GBP" : cfg.defaultCurrency();
        PmsCustomer customer = adapter.findOrCreateCustomer(
                new PmsCustomerRef(DEMO_EMAIL, "Bliss", "Demo"));
        List<PmsStoredCard> cards = adapter.getStoredCards(customer.id());
        System.out.println("mewsCustomerId = " + customer.id());
        System.out.println("currency       = " + currency);
        System.out.println("vaulted cards  = " + cards.size());

        if (cards.isEmpty()) {
            System.out.println();
            System.out.println("No vaulted card on the demo customer, so there is nothing to charge.");
            System.out.println("Vault one first: run MewsAdapterDemo, open the served helper page,");
            System.out.println("enter a Mews demo test card, then rerun this demo.");
            System.out.println();
            System.out.println("== done (awaiting card entry) ==");
            return;
        }
        PmsStoredCard card = cards.get(0);
        System.out.println("mewsCreditCard = " + card.id() + " (" + card.obfuscatedNumber() + ")");

        // 2. Connect + migrate (ensures V16 columns exist).
        String url = env("DATABASE_URL", "jdbc:postgresql://localhost:5432/bliss");
        String user = env("PGUSER", "bliss");
        String pass = env("PGPASSWORD", "bliss_dev");
        Flyway.configure().dataSource(url, user, pass).load().migrate();
        Jdbi jdbi = Jdbi.create(url, user, pass)
                .installPlugin(new SqlObjectPlugin())
                .installPlugin(new PostgresPlugin());

        // 3. Seed a Mews-rail plan with one installment due today, and store the
        //    property's own Mews connection (here the global demo tokens) so the
        //    charge pass resolves credentials per-property, not from a global.
        LocalDate today = LocalDate.now();
        UUID scheduleId = seedMewsRailPlan(jdbi, customer, card, currency, today);
        seedMewsConnection(jdbi, config, cfg, currency);
        System.out.println();
        System.out.println("Seeded Mews-rail plan + property connection; installment due " + today);
        printRow(jdbi, scheduleId, "before");

        // 4. Run the charge pass. The service resolves this property's adapter
        //    from its stored connection via MewsAdapterFactory.
        MewsAdapterFactory factory = new MewsAdapterFactory(jdbi);
        InstallmentChargeService service = new InstallmentChargeService(
                new JdbiLedger(jdbi), factory, Clock.systemUTC());
        PassResult result = service.runDuePass(today);

        // 5. Show the recorded outcome.
        System.out.println();
        System.out.println("pass result = " + result);
        printRow(jdbi, scheduleId, "after");
        System.out.println();
        System.out.println("== done ==");
    }

    /**
     * Recreates the merchant/booking/customer/card graph and a fresh single
     * installment plan on the Mews rail, returning the schedule row id.
     */
    private static UUID seedMewsRailPlan(
            Jdbi jdbi, PmsCustomer customer, PmsStoredCard card, String currency, LocalDate today) {
        return jdbi.inTransaction(h -> {
            // Merchant + booking (fixed ids, created once).
            h.createUpdate("""
                    INSERT INTO merchants (id, slug, business_name, email)
                    VALUES (:id, 'bliss-mews-demo', 'Bliss Mews Demo', 'mews-demo-merchant@bliss.test')
                    ON CONFLICT (id) DO NOTHING
                    """).bind("id", MERCHANT_ID).execute();
            h.createUpdate("""
                    INSERT INTO bookings (id, merchant_id, booking_token, service_name,
                                          total_amount_cents, appointment_date)
                    VALUES (:id, :merchantId, 'mews-demo-token', 'Mews rail demo booking',
                            :total, :appt)
                    ON CONFLICT (id) DO NOTHING
                    """)
                    .bind("id", BOOKING_ID)
                    .bind("merchantId", MERCHANT_ID)
                    .bind("total", INSTALLMENT_CENTS * 2)
                    .bind("appt", today.plusDays(90))
                    .execute();

            // Customer (keyed by email) carrying the Mews account id.
            UUID customerId = h.createQuery("""
                    INSERT INTO customers (email, first_name, last_name, mews_customer_id)
                    VALUES (:email, 'Bliss', 'Demo', :mews)
                    ON CONFLICT (email) DO UPDATE SET mews_customer_id = EXCLUDED.mews_customer_id
                    RETURNING id
                    """)
                    .bind("email", DEMO_EMAIL)
                    .bind("mews", customer.id())
                    .mapTo(UUID.class).one();

            // Card carrying the Mews CreditCardId. stripe_payment_method_id is
            // NOT NULL UNIQUE, so a synthetic value stands in for the demo; the
            // real reference the charge uses is mews_credit_card_id.
            String lastFour = lastFour(card.obfuscatedNumber());
            UUID cardId = h.createQuery("""
                    INSERT INTO customer_cards (customer_id, stripe_payment_method_id,
                            mews_credit_card_id, last_four, exp_month, exp_year, brand, is_default)
                    VALUES (:customerId, :synthetic, :mewsCard, :lastFour, :expMonth, :expYear, :brand, TRUE)
                    ON CONFLICT (stripe_payment_method_id) DO UPDATE
                        SET mews_credit_card_id = EXCLUDED.mews_credit_card_id,
                            customer_id = EXCLUDED.customer_id
                    RETURNING id
                    """)
                    .bind("customerId", customerId)
                    .bind("synthetic", "mews:" + card.id())
                    .bind("mewsCard", card.id())
                    .bind("lastFour", lastFour)
                    .bind("expMonth", card.expiryMonth() == null ? 12 : card.expiryMonth())
                    .bind("expYear", card.expiryYear() == null ? 2030 : card.expiryYear())
                    .bind("brand", card.kind() == null ? "card" : card.kind())
                    .mapTo(UUID.class).one();

            // Fresh plan + single installment (idempotent: drop any prior ones).
            h.createUpdate("DELETE FROM payment_schedule WHERE payment_plan_id IN "
                    + "(SELECT id FROM payment_plans WHERE booking_id = :bid)")
                    .bind("bid", BOOKING_ID).execute();
            h.createUpdate("DELETE FROM payment_plans WHERE booking_id = :bid")
                    .bind("bid", BOOKING_ID).execute();

            UUID planId = h.createQuery("""
                    INSERT INTO payment_plans (booking_id, customer_id, customer_card_id,
                            total_amount_cents, num_payments, frequency, start_date, end_date,
                            processing_fee_cents, status, payment_rail)
                    VALUES (:bookingId, :customerId, :cardId, :total, 2, 'monthly',
                            :start, :end, 0, 'active', 'mews')
                    RETURNING id
                    """)
                    .bind("bookingId", BOOKING_ID)
                    .bind("customerId", customerId)
                    .bind("cardId", cardId)
                    .bind("total", INSTALLMENT_CENTS * 2)
                    .bind("start", today)
                    .bind("end", today.plusDays(30))
                    .mapTo(UUID.class).one();

            UUID sid = h.createQuery("""
                    INSERT INTO payment_schedule (payment_plan_id, sequence, due_date,
                            amount_cents, status, kind)
                    VALUES (:planId, 1, :due, :amount, 'scheduled', 'installment')
                    RETURNING id
                    """)
                    .bind("planId", planId)
                    .bind("due", today)
                    .bind("amount", INSTALLMENT_CENTS)
                    .mapTo(UUID.class).one();
            return sid;
        });
    }

    /**
     * Stores the demo property's own Mews connection (the global demo tokens),
     * validated, so MewsAdapterFactory resolves this merchant's credentials.
     */
    private static void seedMewsConnection(
            Jdbi jdbi, MewsPmsConfig config, PmsPropertyConfiguration cfg, String currency) {
        jdbi.useHandle(h -> h.createUpdate("""
                INSERT INTO merchant_mews_connections (
                    merchant_id, platform_url, client_token, access_token,
                    enterprise_id, enterprise_name, currency, validated_at
                ) VALUES (
                    :merchantId, :platformUrl, :clientToken, :accessToken,
                    :enterpriseId, :enterpriseName, :currency, NOW()
                )
                ON CONFLICT (merchant_id) DO UPDATE SET
                    platform_url = EXCLUDED.platform_url,
                    client_token = EXCLUDED.client_token,
                    access_token = EXCLUDED.access_token,
                    enterprise_id = EXCLUDED.enterprise_id,
                    enterprise_name = EXCLUDED.enterprise_name,
                    currency = EXCLUDED.currency,
                    validated_at = EXCLUDED.validated_at
                """)
                .bind("merchantId", MERCHANT_ID)
                .bind("platformUrl", config.getPlatformUrl())
                .bind("clientToken", config.getClientToken())
                .bind("accessToken", config.getAccessToken())
                .bind("enterpriseId", cfg.enterpriseId())
                .bind("enterpriseName", cfg.name())
                .bind("currency", currency)
                .execute());
    }

    private static void printRow(Jdbi jdbi, UUID scheduleId, String label) {
        Optional<Map<String, Object>> row = jdbi.withHandle(h -> h.createQuery("""
                SELECT status, mews_payment_id, paid_at, last_error
                FROM payment_schedule WHERE id = :id
                """).bind("id", scheduleId).mapToMap().findOne());
        row.ifPresent(r -> System.out.printf(
                "  %-6s status=%s mews_payment_id=%s paid_at=%s last_error=%s%n",
                label, r.get("status"), r.get("mews_payment_id"), r.get("paid_at"), r.get("last_error")));
    }

    private static String lastFour(String obfuscated) {
        if (obfuscated == null || obfuscated.length() < 4) {
            return "0000";
        }
        return obfuscated.substring(obfuscated.length() - 4);
    }

    private static String env(String key, String fallback) {
        String v = System.getenv(key);
        return v == null || v.isBlank() ? fallback : v;
    }
}
