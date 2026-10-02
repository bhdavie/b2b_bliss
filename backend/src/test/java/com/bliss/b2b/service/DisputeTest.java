package com.bliss.b2b.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import com.bliss.b2b.BlissConfiguration.StripeConfig;
import com.bliss.b2b.api.PlansResource;
import com.bliss.b2b.api.StripePlatformWebhookResource;
import com.bliss.b2b.auth.MerchantPrincipal;
import com.bliss.b2b.domain.Merchant;
import com.bliss.b2b.integration.EmailMessage;
import com.bliss.b2b.integration.StripeConnectService;
import com.bliss.b2b.persistence.BookingDao;
import com.bliss.b2b.persistence.MerchantDao;
import com.bliss.b2b.persistence.PaymentPlanDao;
import com.bliss.b2b.persistence.PaymentScheduleDao;
import com.bliss.b2b.persistence.PlanDisputeDao;
import com.bliss.b2b.persistence.migration.V30__Encrypt_pms_connection_tokens;
import com.bliss.b2b.security.TokenCipher;
import jakarta.ws.rs.core.Response;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.Statement;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.flywaydb.core.Flyway;
import org.jdbi.v3.core.Jdbi;
import org.jdbi.v3.sqlobject.SqlObjectPlugin;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

/**
 * Card disputes (docs/disputes-spec.md): attached to the disputed payment's
 * plan, flagged to the hotel and in admin, Bliss operations emailed once; the
 * platform endpoint verifies with its own secret. Throwaway Postgres; SKIPS
 * without one.
 */
class DisputeTest {

    private static final String ADMIN_URL = System.getenv().getOrDefault(
            "BLISS_TEST_DB_URL", "jdbc:postgresql://localhost:5432/bliss");
    private static final String DB_NAME =
            "bliss_disputetest_" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);
    private static final String PLATFORM_SECRET = "whsec_platform_test_secret";
    private static final String CONNECT_SECRET = "whsec_connect_test_secret";

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

    private DisputeService service() {
        return new DisputeService(jdbi, emails::add, "ops@bliss.test");
    }

    /** A property and a Stripe plan whose first payment was paid by {@code intentId}. */
    private record Fixture(Merchant merchant, UUID planId) {
    }

    private static Fixture planPaidBy(String intentId) {
        UUID id = UUID.randomUUID();
        return jdbi.inTransaction(h -> {
            UUID merchant = h.createQuery("""
                    INSERT INTO merchants (slug, email, business_name, pms_type, currency, time_zone, locale,
                                           onboarding_state)
                    VALUES (:s, :e, 'Cranberry Trail Inn', 'stripe', 'USD', 'America/New_York', 'en-US', 'active')
                    RETURNING id""")
                    .bind("s", "c" + id.toString().substring(0, 7)).bind("e", id + "@inn.test")
                    .mapTo(UUID.class).one();
            UUID booking = h.createQuery("""
                    INSERT INTO bookings (merchant_id, booking_token, service_name, total_amount_cents,
                                          appointment_date, status, booking_source, currency, time_zone, locale)
                    VALUES (:m, :t, 'Two nights', 60000, :d, 'accepted', 'merchant_initiated', 'USD',
                            'America/New_York', 'en-US') RETURNING id""")
                    .bind("m", merchant).bind("t", "tok-" + id).bind("d", LocalDate.of(2027, 3, 1))
                    .mapTo(UUID.class).one();
            UUID customer = h.createQuery("""
                    INSERT INTO customers (email, first_name, last_name, stripe_customer_id)
                    VALUES (:e, 'Guest', 'One', :cus) RETURNING id""")
                    .bind("e", "g-" + id + "@example.com").bind("cus", "cus_" + id.toString().substring(0, 10))
                    .mapTo(UUID.class).one();
            UUID card = h.createQuery("""
                    INSERT INTO customer_cards (customer_id, stripe_payment_method_id, last_four, exp_month,
                                                exp_year, brand, is_default)
                    VALUES (:c, :pm, '4242', 12, 2030, 'visa', TRUE) RETURNING id""")
                    .bind("c", customer).bind("pm", "pm_" + id).mapTo(UUID.class).one();
            UUID plan = h.createQuery("""
                    INSERT INTO payment_plans (booking_id, customer_id, customer_card_id, total_amount_cents,
                                               num_payments, frequency, start_date, end_date,
                                               deposit_amount_cents, processing_fee_cents, status, payment_rail)
                    VALUES (:b, :c, :card, 60000, 2, 'monthly', :s, :e, 0, 0, 'active', 'stripe') RETURNING id""")
                    .bind("b", booking).bind("c", customer).bind("card", card)
                    .bind("s", LocalDate.of(2026, 10, 2)).bind("e", LocalDate.of(2026, 11, 2))
                    .mapTo(UUID.class).one();
            h.createUpdate("""
                    INSERT INTO payment_schedule (payment_plan_id, sequence, due_date, amount_cents, status, kind,
                                                  stripe_payment_intent_id, paid_at)
                    VALUES (:p, 1, :d, 30000, 'paid', 'installment', :pi, NOW()),
                           (:p, 2, :d2, 30000, 'scheduled', 'installment', NULL, NULL)""")
                    .bind("p", plan).bind("d", LocalDate.of(2026, 10, 2)).bind("d2", LocalDate.of(2026, 11, 2))
                    .bind("pi", intentId).execute();
            return new Fixture(h.attach(MerchantDao.class).findById(merchant).orElseThrow(), plan);
        });
    }

    private static String dispute(String disputeId, String intentId, String status) {
        return """
                {"id": "%s", "object": "dispute", "amount": 30000, "currency": "usd", "charge": "ch_1",
                 "payment_intent": %s, "reason": "product_not_received", "status": "%s", "livemode": true,
                 "evidence_details": {"due_by": 1792540800}}
                """.formatted(disputeId, intentId == null ? "null" : "\"" + intentId + "\"", status);
    }

    private static String id(String prefix) {
        return prefix + UUID.randomUUID().toString().replace("-", "").substring(0, 12);
    }

    private PlansResource plans() {
        return new PlansResource(jdbi.onDemand(PaymentPlanDao.class), jdbi.onDemand(PaymentScheduleDao.class),
                jdbi.onDemand(BookingDao.class), null).withDisputes(jdbi.onDemand(PlanDisputeDao.class));
    }

    @Test
    void aNewDisputeIsAttachedToItsPlanFlaggedToTheHotelAndEmailedOnce() {
        String pi = id("pi_");
        Fixture f = planPaidBy(pi);
        String disputeId = id("du_");

        assertThat(service().apply("charge.dispute.created", dispute(disputeId, pi, "needs_response")))
                .isEqualTo(DisputeService.Outcome.RECORDED);
        assertThat(service().apply("charge.dispute.created", dispute(disputeId, pi, "needs_response")))
                .as("Stripe retries the same event").isEqualTo(DisputeService.Outcome.ALREADY_KNOWN);

        PlanDisputeDao.Dispute d = jdbi.onDemand(PlanDisputeDao.class).find(disputeId).orElseThrow();
        assertThat(d.planId()).isEqualTo(f.planId());
        assertThat(d.merchantId()).isEqualTo(f.merchant().id());
        assertThat(d.scheduleId()).isNotNull();
        assertThat(d.open()).isTrue();

        PlansResource.AttentionResponse attention = plans().listAttention(new MerchantPrincipal(f.merchant()));
        assertThat(attention.plans()).singleElement().satisfies(p -> {
            assertThat(p.id()).isEqualTo(f.planId().toString());
            assertThat(p.disputes()).singleElement().satisfies(v -> {
                assertThat(v.open()).isTrue();
                assertThat(v.amountCents()).isEqualTo(30_000);
                assertThat(v.reason()).isEqualTo("product_not_received");
            });
        });

        assertThat(emails).filteredOn(e -> e.to().equals(f.merchant().email())).singleElement().satisfies(e -> {
            assertThat(e.subject()).isEqualTo("A guest disputed a payment");
            assertThat(e.body()).contains("A guest disputed $300.00 with their card bank, for Two nights")
                    .contains("Reason: product not received").contains("Bliss has been told")
                    .doesNotContain("\u2014");
        });
        assertThat(emails).filteredOn(e -> e.to().equals("ops@bliss.test")).singleElement().satisfies(e -> {
            assertThat(e.subject()).isEqualTo("Card dispute: $300.00 at Cranberry Trail Inn");
            assertThat(e.body()).contains("Reason: product not received").contains("Stay: Two nights")
                    .contains("https://dashboard.stripe.com/disputes/" + disputeId).doesNotContain("—");
        });
    }

    @Test
    void aClosedDisputeStopsBeingFlagged() {
        String pi = id("pi_");
        Fixture f = planPaidBy(pi);
        String disputeId = id("du_");
        service().apply("charge.dispute.created", dispute(disputeId, pi, "needs_response"));

        assertThat(service().apply("charge.dispute.closed", dispute(disputeId, pi, "won")))
                .isEqualTo(DisputeService.Outcome.UPDATED);

        PlanDisputeDao.Dispute d = jdbi.onDemand(PlanDisputeDao.class).find(disputeId).orElseThrow();
        assertThat(d.status()).isEqualTo("won");
        assertThat(d.closedAt()).isNotNull();
        assertThat(plans().listAttention(new MerchantPrincipal(f.merchant())).plans()).isEmpty();
        assertThat(emails).as("only the opening is emailed, to Bliss and the hotel").hasSize(2);
    }

    @Test
    void aDisputeBlissCannotMatchIsStillRecordedAndEmailed() {
        String disputeId = id("du_");

        service().apply("charge.dispute.created", dispute(disputeId, "pi_not_ours", "needs_response"));

        PlanDisputeDao.Dispute d = jdbi.onDemand(PlanDisputeDao.class).find(disputeId).orElseThrow();
        assertThat(d.planId()).isNull();
        assertThat(emails).singleElement().satisfies(e ->
                assertThat(e.body()).contains("Plan: not matched"));
    }

    @Test
    void theAdminPropertyViewListsItsDisputes() {
        String pi = id("pi_");
        Fixture f = planPaidBy(pi);
        String disputeId = id("du_");
        service().apply("charge.dispute.created", dispute(disputeId, pi, "warning_needs_response"));

        AdminMerchantsService.MerchantDetail detail = new AdminMerchantsService(jdbi)
                .detail(f.merchant().id(), java.time.Instant.now()).orElseThrow();

        assertThat(detail.disputes()).extracting(PlanDisputeDao.Dispute::stripeDisputeId).containsExactly(disputeId);
    }

    // --- The platform endpoint ------------------------------------------------

    private static StripeConnectService stripe(String platformSecret) {
        StripeConfig config = new StripeConfig();
        config.setWebhookSecret(CONNECT_SECRET);
        config.setPlatformWebhookSecret(platformSecret);
        return new StripeConnectService(config);
    }

    private static String sign(String payload, String secret) throws Exception {
        long t = System.currentTimeMillis() / 1000;
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        String sig = HexFormat.of().formatHex(mac.doFinal((t + "." + payload).getBytes(StandardCharsets.UTF_8)));
        return "t=" + t + ",v1=" + sig;
    }

    private static String event(String type, String disputeJson) {
        return """
                {"id": "%s", "object": "event", "type": "%s", "api_version": "2025-01-27.acacia",
                 "data": {"object": %s}}""".formatted(id("evt_"), type, disputeJson);
    }

    @Test
    void thePlatformEndpointAcceptsItsOwnSignatureOnly() throws Exception {
        String pi = id("pi_");
        planPaidBy(pi);
        String disputeId = id("du_");
        String payload = event("charge.dispute.created", dispute(disputeId, pi, "needs_response"));
        StripePlatformWebhookResource resource =
                new StripePlatformWebhookResource(stripe(PLATFORM_SECRET), service());

        Response wrongSecret = resource.webhook(sign(payload, CONNECT_SECRET), payload);
        assertThat(wrongSecret.getStatus()).as("signed for the Connect endpoint").isEqualTo(400);
        assertThat(jdbi.onDemand(PlanDisputeDao.class).find(disputeId)).isEmpty();

        Response ok = resource.webhook(sign(payload, PLATFORM_SECRET), payload);
        assertThat(ok.getStatus()).isEqualTo(200);
        assertThat(jdbi.onDemand(PlanDisputeDao.class).find(disputeId)).isPresent();

        String other = event("payment_intent.succeeded", "{\"id\": \"pi_x\", \"object\": \"payment_intent\"}");
        assertThat(resource.webhook(sign(other, PLATFORM_SECRET), other).getStatus())
                .as("other events are acknowledged").isEqualTo(200);
    }

    @Test
    void withoutItsSecretThePlatformEndpointAnswers503() throws Exception {
        String payload = event("charge.dispute.created", dispute(id("du_"), null, "needs_response"));
        Response res = new StripePlatformWebhookResource(stripe(""), service())
                .webhook(sign(payload, PLATFORM_SECRET), payload);

        assertThat(res.getStatus()).isEqualTo(503);
    }
}
