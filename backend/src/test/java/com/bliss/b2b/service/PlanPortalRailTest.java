package com.bliss.b2b.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import com.bliss.b2b.BlissConfiguration.StripeConfig;
import com.bliss.b2b.integration.StripeConnectResolver;
import com.bliss.b2b.integration.StripePaymentsService;
import com.bliss.b2b.integration.pms.PmsAdapter;
import com.bliss.b2b.integration.pms.PmsChargeResult;
import com.bliss.b2b.integration.pms.PmsChargeStatus;
import com.bliss.b2b.integration.pms.PmsCustomer;
import com.bliss.b2b.integration.pms.PmsCustomerRef;
import com.bliss.b2b.integration.pms.PmsPropertyConfiguration;
import com.bliss.b2b.integration.pms.PmsStoredCard;
import com.bliss.b2b.persistence.PaymentPlanDao.ChargeRoute;
import com.bliss.b2b.persistence.migration.V30__Encrypt_pms_connection_tokens;
import com.bliss.b2b.security.TokenCipher;
import com.bliss.b2b.service.InstallmentChargeService.ChargeContext;
import com.bliss.b2b.service.PlanPortalService.PayResult;
import com.bliss.b2b.service.PlanPortalService.PortalErrorCode;
import com.bliss.b2b.service.PlanPortalService.PortalException;
import com.bliss.b2b.service.PlanPortalService.Route;
import com.stripe.model.PaymentIntent;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.Statement;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.jdbi.v3.core.Jdbi;
import org.jdbi.v3.sqlobject.SqlObjectPlugin;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * Guest pay early and pay off charge through the plan's own rail: a Stripe
 * plan through Stripe, a Mews plan through the property's Mews, never the
 * other. Runs against a throwaway Postgres database (created, migrated and
 * dropped here) with a fake Stripe and a fake Mews; SKIPS when Postgres is not
 * reachable or the user cannot create databases.
 */
class PlanPortalRailTest {

    private static final String ADMIN_URL = System.getenv().getOrDefault(
            "BLISS_TEST_DB_URL", "jdbc:postgresql://localhost:5432/bliss");
    private static final String DB_NAME =
            "bliss_portaltest_" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);
    private static final TokenCipher CIPHER = TokenCipher.development();
    private static final Clock CLOCK = Clock.fixed(Instant.parse("2026-10-01T12:00:00Z"), ZoneOffset.UTC);

    /** Makes fake payment ids unique per test, as real ones are; the email log dedupes on them. */
    private static String RUN = UUID.randomUUID().toString();

    private static Jdbi jdbi;
    private static String dbUrl;

    private FakeStripe stripe;
    private FakeMews mews;
    private String mewsCurrency;

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
        Flyway.configure()
                .dataSource(dbUrl, null, null)
                .locations("classpath:db/migration")
                .javaMigrations(new V30__Encrypt_pms_connection_tokens(CIPHER))
                .load()
                .migrate();
        jdbi = Jdbi.create(dbUrl).installPlugin(new SqlObjectPlugin());
    }

    @AfterAll
    static void dropDatabase() throws Exception {
        if (dbUrl == null) return;
        try (Connection admin = DriverManager.getConnection(ADMIN_URL); Statement st = admin.createStatement()) {
            st.execute("DROP DATABASE IF EXISTS " + DB_NAME + " WITH (FORCE)");
        }
    }

    @BeforeEach
    void setUp() {
        RUN = UUID.randomUUID().toString();
        stripe = new FakeStripe(true);
        mews = new FakeMews();
        mewsCurrency = "GBP";
    }

    private PlanPortalService service() {
        return service(PlanNotificationService.disabled());
    }

    private PlanPortalService service(PlanNotificationService notifications) {
        return new PlanPortalService(jdbi, stripe, new StripeConnectResolver(jdbi),
                merchantId -> Optional.of(new ChargeContext(mews, mewsCurrency)), null,
                notifications, CLOCK);
    }

    // --------------------------------------------------------------- receipts

    private final List<com.bliss.b2b.integration.EmailMessage> emails =
            java.util.Collections.synchronizedList(new ArrayList<>());

    private PlanNotificationService recordingNotifications() {
        emails.clear();
        return new PlanNotificationService(jdbi, emails::add, "http://localhost:3000");
    }

    private List<String> receiptSubjects() {
        return emails.stream().map(com.bliss.b2b.integration.EmailMessage::subject)
                .filter(sub -> sub.startsWith("Receipt")).toList();
    }

    @Test
    void mewsPayOff_sendsOneReceiptForTheFullAmount() {
        PlanNotificationService notifications = recordingNotifications();
        Fixture f = plan("mews", "GBP", "mews_link_res-r1", "cust-r1", "card-r1", "res-r1");

        service(notifications).payRemainingBalance(f.token);

        assertThat(receiptSubjects()).containsExactly("Receipt: £600.00 payment to Test Inn");
    }

    @Test
    void stripePayOff_sendsOneReceiptForTheFullAmount() {
        PlanNotificationService notifications = recordingNotifications();
        Fixture f = plan("stripe", "GBP", "pm_real_" + UUID.randomUUID(), null, null, null);

        service(notifications).payRemainingBalance(f.token);

        assertThat(receiptSubjects()).containsExactly("Receipt: £600.00 payment to Test Inn");
    }

    @Test
    void mewsPayOffSettledByReconciliation_sendsOneReceiptOnceEveryRowHasSettled() {
        PlanNotificationService notifications = recordingNotifications();
        mews.next = PmsChargeStatus.PENDING;
        Fixture f = plan("mews", "GBP", "mews_link_res-r2", "cust-r2", "card-r2", "res-r2");

        service(notifications).payRemainingBalance(f.token);
        assertThat(receiptSubjects()).as("nothing settled yet").isEmpty();

        // Reconciliation settles the pay off's rows one at a time and notifies
        // each, as MewsReconciliationService does.
        List<UUID> rows = jdbi.withHandle(h -> h.createQuery(
                        "SELECT id FROM payment_schedule WHERE payment_plan_id = :p AND status = 'processing' "
                                + "ORDER BY sequence")
                .bind("p", f.planId).mapTo(UUID.class).list());
        assertThat(rows).hasSize(2);
        for (UUID row : rows) {
            jdbi.useHandle(h -> h.attach(com.bliss.b2b.persistence.PaymentScheduleDao.class)
                    .markPaidMews(row, "mews-pay-1-" + RUN, CLOCK.instant()));
            notifications.onInstallmentPaid(f.planId, row);
            if (row.equals(rows.get(0))) {
                assertThat(receiptSubjects()).as("first row settled, second still processing").isEmpty();
            }
        }

        assertThat(receiptSubjects()).containsExactly("Receipt: £600.00 payment to Test Inn");
    }

    @Test
    void payEarly_stillSendsAReceiptForThatInstallment() {
        PlanNotificationService notifications = recordingNotifications();
        Fixture f = plan("mews", "GBP", "mews_link_res-r3", "cust-r3", "card-r3", "res-r3");

        service(notifications).payNextInstallment(f.token);

        assertThat(receiptSubjects()).containsExactly("Receipt: £300.00 payment to Test Inn");
    }

    // ------------------------------------------------------------ Stripe rail

    @Test
    void stripePlan_payEarly_chargesStripeInTheBookingsCurrency_andNeverMews() {
        Fixture f = plan("stripe", "GBP", "pm_real_" + UUID.randomUUID(), null, null, null);

        PayResult result = service().payNextInstallment(f.token);

        assertThat(stripe.calls).hasSize(1);
        assertThat(stripe.calls.get(0).amountMinor()).isEqualTo(30_000L);
        assertThat(stripe.calls.get(0).currency()).isEqualTo("GBP");
        assertThat(mews.charges).isEmpty();
        assertThat(result.status()).isEqualTo("succeeded");
        assertThat(statuses(f)).containsExactly("paid", "paid", "scheduled");
    }

    @Test
    void stripePlan_payOff_isOneStripeChargeForTheBalance() {
        Fixture f = plan("stripe", "GBP", "pm_real_" + UUID.randomUUID(), null, null, null);

        service().payRemainingBalance(f.token);

        assertThat(stripe.calls).hasSize(1);
        assertThat(stripe.calls.get(0).amountMinor()).isEqualTo(60_000L);
        assertThat(mews.charges).isEmpty();
        assertThat(statuses(f)).containsExactly("paid", "paid", "paid");
        assertThat(planStatus(f)).isEqualTo("completed");
    }

    // -------------------------------------------------------------- Mews rail

    @Test
    void mewsPlan_payEarly_chargesTheMewsCard_andNeverStripe() {
        Fixture f = plan("mews", "GBP", "mews_link_res-1", "cust-1", "card-1", "res-1");

        PayResult result = service().payNextInstallment(f.token);

        assertThat(stripe.calls).isEmpty();
        assertThat(mews.charges).hasSize(1);
        FakeMews.Charge c = mews.charges.get(0);
        assertThat(c.customerId()).isEqualTo("cust-1");
        assertThat(c.cardId()).isEqualTo("card-1");
        assertThat(c.reservationId()).isEqualTo("res-1");
        assertThat(c.amountMinor()).isEqualTo(30_000L);
        assertThat(c.currency()).isEqualTo("GBP");
        assertThat(result.paymentIntentId()).startsWith("mews-pay-1-");
        assertThat(result.status()).isEqualTo("succeeded");
        assertThat(statuses(f)).containsExactly("paid", "paid", "scheduled");
        assertThat(mewsPaymentIds(f).get(1)).startsWith("mews-pay-1-");
    }

    @Test
    void mewsPlan_payEarly_goesToMewsEvenWhenStripeIsNotConfigured() {
        // The old code sent every pay early to the demo branch whenever Stripe
        // was not configured, marking a Mews installment paid without charging.
        stripe = new FakeStripe(false);
        Fixture f = plan("mews", "GBP", "mews_link_res-2", "cust-2", "card-2", "res-2");

        service().payNextInstallment(f.token);

        assertThat(mews.charges).hasSize(1);
        assertThat(stripe.calls).isEmpty();
    }

    @Test
    void mewsPlan_payOff_isOneMewsChargeForTheBalance_andCompletesThePlan() {
        Fixture f = plan("mews", "GBP", "mews_link_res-3", "cust-3", "card-3", "res-3");

        service().payRemainingBalance(f.token);

        assertThat(mews.charges).hasSize(1);
        assertThat(mews.charges.get(0).amountMinor()).isEqualTo(60_000L);
        assertThat(stripe.calls).isEmpty();
        assertThat(statuses(f)).containsExactly("paid", "paid", "paid");
        assertThat(mewsPaymentIds(f).subList(1, 3)).allMatch(id -> id.startsWith("mews-pay-1-"));
        assertThat(planStatus(f)).isEqualTo("completed");
    }

    @Test
    void mewsPlan_unsettledCharge_leavesTheRowProcessingForReconciliation() {
        mews.next = PmsChargeStatus.PENDING;
        Fixture f = plan("mews", "GBP", "mews_link_res-4", "cust-4", "card-4", "res-4");

        PayResult result = service().payNextInstallment(f.token);

        assertThat(result.status()).isEqualTo("processing");
        assertThat(statuses(f)).containsExactly("paid", "processing", "scheduled");
        assertThat(mewsPaymentIds(f).get(1)).startsWith("mews-pay-1-");
    }

    @Test
    void mewsPlan_decline_writesNothing() {
        mews.next = PmsChargeStatus.FAILED;
        Fixture f = plan("mews", "GBP", "mews_link_res-5", "cust-5", "card-5", "res-5");

        assertThatThrownBy(() -> service().payNextInstallment(f.token))
                .isInstanceOf(PortalException.class)
                .extracting(e -> ((PortalException) e).code()).isEqualTo(PortalErrorCode.CARD_DECLINED);
        assertThat(statuses(f)).containsExactly("paid", "scheduled", "scheduled");
    }

    @Test
    void mewsPlan_cancelledStay_isNotCharged() {
        mews.reservationState = "Canceled";
        Fixture f = plan("mews", "GBP", "mews_link_res-6", "cust-6", "card-6", "res-6");

        assertThatThrownBy(() -> service().payNextInstallment(f.token))
                .extracting(e -> ((PortalException) e).code()).isEqualTo(PortalErrorCode.PLAN_NOT_ACTIVE);
        assertThat(mews.charges).isEmpty();
    }

    @Test
    void mewsPlan_propertyCurrencyChanged_isNotCharged() {
        mewsCurrency = "EUR";
        Fixture f = plan("mews", "GBP", "mews_link_res-7", "cust-7", "card-7", "res-7");

        assertThatThrownBy(() -> service().payNextInstallment(f.token))
                .extracting(e -> ((PortalException) e).code()).isEqualTo(PortalErrorCode.RAIL_UNAVAILABLE);
        assertThat(mews.charges).isEmpty();
        assertThat(statuses(f)).containsExactly("paid", "scheduled", "scheduled");
    }

    // ------------------------------------------------- concurrent payers

    private InstallmentChargeService chargePass() {
        return new InstallmentChargeService(new InstallmentChargeService.JdbiLedger(jdbi),
                merchantId -> Optional.of(new ChargeContext(mews, mewsCurrency)), CLOCK);
    }

    @Test
    void payEarlyAndTheChargePassAtOnce_chargeTheInstallmentOnce() throws Exception {
        // Installment 2 is due today, so the pass picks it up while the guest
        // is paying it early.
        Fixture f = plan("mews", "GBP", "mews_link_res-c1", "cust-c1", "card-c1", "res-c1", "2026-10-01");
        mews.holdFirstCharge();
        java.util.concurrent.ExecutorService pool = java.util.concurrent.Executors.newFixedThreadPool(2);
        try {
            var payEarly = pool.submit(() -> service().payNextInstallment(f.token));
            assertThat(mews.entered.await(5, java.util.concurrent.TimeUnit.SECONDS))
                    .as("pay early reached Mews holding the plan lock").isTrue();

            var pass = pool.submit(() -> chargePass().runDuePass(CLOCK.instant()));
            Thread.sleep(500);
            assertThat(pass.isDone()).as("the pass waits for the lock instead of charging").isFalse();
            assertThat(mews.charges).hasSize(1);

            mews.release.countDown();
            payEarly.get(10, java.util.concurrent.TimeUnit.SECONDS);
            InstallmentChargeService.PassResult result = pass.get(10, java.util.concurrent.TimeUnit.SECONDS);

            assertThat(mews.charges).as("one charge for the one installment").hasSize(1);
            assertThat(result.charged()).isZero();
            assertThat(result.alreadySettled()).isEqualTo(1);
            assertThat(statuses(f)).containsExactly("paid", "paid", "scheduled");
            assertThat(mewsPaymentIds(f).get(1)).startsWith("mews-pay-1-");
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    void chargePassThenPayOffAtOnce_payOffChargesOnlyWhatThePassDidNotPay() throws Exception {
        Fixture f = plan("mews", "GBP", "mews_link_res-c2", "cust-c2", "card-c2", "res-c2", "2026-10-01");
        mews.holdFirstCharge();
        java.util.concurrent.ExecutorService pool = java.util.concurrent.Executors.newFixedThreadPool(2);
        try {
            var pass = pool.submit(() -> chargePass().runDuePass(CLOCK.instant()));
            assertThat(mews.entered.await(5, java.util.concurrent.TimeUnit.SECONDS))
                    .as("the pass reached Mews holding the plan lock").isTrue();

            var payOff = pool.submit(() -> service().payRemainingBalance(f.token));
            Thread.sleep(500);
            assertThat(payOff.isDone()).as("pay off waits for the lock").isFalse();

            mews.release.countDown();
            pass.get(10, java.util.concurrent.TimeUnit.SECONDS);
            payOff.get(10, java.util.concurrent.TimeUnit.SECONDS);

            // The pass charged installment 2; pay off then saw only installment
            // 3 unpaid. 600.00 in total, never 900.00.
            assertThat(mews.charges).extracting(FakeMews.Charge::amountMinor)
                    .containsExactly(30_000L, 30_000L);
            assertThat(statuses(f)).containsExactly("paid", "paid", "paid");
            assertThat(planStatus(f)).isEqualTo("completed");
        } finally {
            pool.shutdownNow();
        }
    }

    // ---------------------------------------------------------------- routing

    @Test
    void routeFollowsTheRailNotStripeConfiguration() {
        ChargeRoute mewsCard = new ChargeRoute("mews", "cust", "card", "mews_link_x", "res");
        ChargeRoute mewsDemo = new ChargeRoute("mews", null, null, "pm_demo_abc", null);
        ChargeRoute mewsNoCard = new ChargeRoute("mews", null, null, "mews_link_y", null);
        ChargeRoute stripePlan = new ChargeRoute("stripe", null, null, "pm_123", null);

        assertThat(PlanPortalService.routeOf(mewsCard, true)).isEqualTo(Route.MEWS);
        assertThat(PlanPortalService.routeOf(mewsCard, false)).isEqualTo(Route.MEWS);
        assertThat(PlanPortalService.routeOf(mewsDemo, true)).isEqualTo(Route.DEMO);
        assertThat(PlanPortalService.routeOf(stripePlan, true)).isEqualTo(Route.STRIPE);
        assertThat(PlanPortalService.routeOf(stripePlan, false)).isEqualTo(Route.DEMO);
        assertThatThrownBy(() -> PlanPortalService.routeOf(mewsNoCard, true))
                .extracting(e -> ((PortalException) e).code()).isEqualTo(PortalErrorCode.NO_CARD_ON_FILE);
        assertThatThrownBy(() -> PlanPortalService.routeOf(
                new ChargeRoute("cloudbeds", null, null, "x", null), true))
                .extracting(e -> ((PortalException) e).code()).isEqualTo(PortalErrorCode.RAIL_UNAVAILABLE);
    }

    // --------------------------------------------------------------- fixtures

    private record Fixture(UUID planId, String token) {}

    /** An active plan: deposit paid, then two 300.00 installments still scheduled. */
    private Fixture plan(String rail, String currency, String cardKey,
            String mewsCustomerId, String mewsCardId, String reservationId) {
        return plan(rail, currency, cardKey, mewsCustomerId, mewsCardId, reservationId, "2026-12-02");
    }

    /** The same plan with installment 2 due on {@code secondDue}. */
    private Fixture plan(String rail, String currency, String cardKey,
            String mewsCustomerId, String mewsCardId, String reservationId, String secondDue) {
        UUID id = UUID.randomUUID();
        String token = "tok-" + id.toString().substring(0, 12);
        return jdbi.inTransaction(h -> {
            UUID merchantId = h.createQuery("""
                    INSERT INTO merchants (slug, email, business_name, pms_type, currency, time_zone, locale)
                    VALUES (:slug, :email, 'Test Inn', :pms, :currency, 'Europe/London', 'en-GB')
                    RETURNING id""")
                    .bind("slug", "t" + id.toString().substring(0, 8))
                    .bind("email", id + "@inn.test")
                    .bind("pms", rail)
                    .bind("currency", currency)
                    .mapTo(UUID.class).one();
            UUID bookingId = h.createQuery("""
                    INSERT INTO bookings (merchant_id, booking_token, service_name, total_amount_cents,
                                          appointment_date, status, booking_source, mews_reservation_id,
                                          currency, time_zone, locale)
                    VALUES (:m, :token, 'Two nights', 90000, :appt, 'accepted', 'merchant_initiated', :res,
                            :currency, 'Europe/London', 'en-GB')
                    RETURNING id""")
                    .bind("m", merchantId).bind("token", token)
                    .bind("appt", LocalDate.of(2027, 3, 1)).bind("res", reservationId)
                    .bind("currency", currency)
                    .mapTo(UUID.class).one();
            UUID customerId = h.createQuery("""
                    INSERT INTO customers (email, first_name, last_name, stripe_customer_id, mews_customer_id)
                    VALUES (:email, 'Guest', 'One', :stripeCustomer, :mews) RETURNING id""")
                    .bind("email", "guest-" + id + "@example.com").bind("mews", mewsCustomerId)
                    .bind("stripeCustomer", "cus_" + id.toString().substring(0, 12))
                    .mapTo(UUID.class).one();
            UUID cardId = h.createQuery("""
                    INSERT INTO customer_cards (customer_id, stripe_payment_method_id, mews_credit_card_id,
                                                last_four, exp_month, exp_year, brand, is_default)
                    VALUES (:c, :key, :mewsCard, '1111', 12, 2030, 'visa', TRUE) RETURNING id""")
                    .bind("c", customerId).bind("key", cardKey).bind("mewsCard", mewsCardId)
                    .mapTo(UUID.class).one();
            UUID planId = h.createQuery("""
                    INSERT INTO payment_plans (booking_id, customer_id, customer_card_id, total_amount_cents,
                                               num_payments, frequency, start_date, end_date,
                                               deposit_amount_cents, processing_fee_cents, status, payment_rail)
                    VALUES (:b, :c, :card, 90000, 2, 'monthly', :start, :end, 30000, 0, 'active', :rail)
                    RETURNING id""")
                    .bind("b", bookingId).bind("c", customerId).bind("card", cardId)
                    .bind("start", LocalDate.of(2026, 10, 1)).bind("end", LocalDate.of(2027, 1, 4))
                    .bind("rail", rail)
                    .mapTo(UUID.class).one();
            String[][] rows = {
                    {"1", "2026-10-01", "paid", "deposit"},
                    {"2", secondDue, "scheduled", "installment"},
                    {"3", "2027-01-04", "scheduled", "installment"}};
            for (String[] r : rows) {
                h.createUpdate("""
                        INSERT INTO payment_schedule (payment_plan_id, sequence, due_date, amount_cents, status, kind)
                        VALUES (:p, :seq, :due, 30000, :status, :kind)""")
                        .bind("p", planId).bind("seq", Integer.parseInt(r[0]))
                        .bind("due", LocalDate.parse(r[1])).bind("status", r[2]).bind("kind", r[3])
                        .execute();
            }
            return new Fixture(planId, token);
        });
    }

    private List<String> statuses(Fixture f) {
        return jdbi.withHandle(h -> h.createQuery(
                        "SELECT status FROM payment_schedule WHERE payment_plan_id = :p ORDER BY sequence")
                .bind("p", f.planId).mapTo(String.class).list());
    }

    private List<String> mewsPaymentIds(Fixture f) {
        return jdbi.withHandle(h -> h.createQuery(
                        "SELECT mews_payment_id FROM payment_schedule WHERE payment_plan_id = :p ORDER BY sequence")
                .bind("p", f.planId).mapTo(String.class).list());
    }

    private String planStatus(Fixture f) {
        return jdbi.withHandle(h -> h.createQuery("SELECT status FROM payment_plans WHERE id = :p")
                .bind("p", f.planId).mapTo(String.class).one());
    }

    /** Stripe that records calls and always succeeds. */
    private static final class FakeStripe extends StripePaymentsService {
        private final boolean configured;
        final List<Call> calls = new ArrayList<>();

        FakeStripe(boolean configured) {
            super(new StripeConfig());
            this.configured = configured;
        }

        @Override public boolean isConfigured() {
            return configured;
        }

        @Override public PaymentIntent firePaymentOffSession(long amountCents, String currency,
                String stripeCustomerId, String paymentMethodId, String idempotencyKey,
                Map<String, String> metadata, Destination destination, SessionMode sessionMode) {
            calls.add(new Call(amountCents, currency));
            PaymentIntent intent = new PaymentIntent();
            intent.setId("pi_test_" + calls.size() + "_" + UUID.randomUUID());
            intent.setStatus("succeeded");
            return intent;
        }

        record Call(long amountMinor, String currency) {}
    }

    /**
     * Mews that records charges and answers with {@link #next}. After
     * {@link #holdFirstCharge} the first charge parks inside Mews until
     * {@link #release} opens, so a test can start a second payer while the
     * first is mid-charge.
     */
    private static final class FakeMews implements PmsAdapter {
        PmsChargeStatus next = PmsChargeStatus.CHARGED;
        String reservationState = "Confirmed";
        final List<Charge> charges = java.util.Collections.synchronizedList(new ArrayList<>());
        final java.util.concurrent.CountDownLatch entered = new java.util.concurrent.CountDownLatch(1);
        java.util.concurrent.CountDownLatch release;

        void holdFirstCharge() {
            release = new java.util.concurrent.CountDownLatch(1);
        }

        @Override public PmsChargeResult chargeStoredCard(String pmsCustomerId, String pmsCardId,
                long amountMinorUnits, String currency, String reservationRef, String notes) {
            int n;
            synchronized (charges) {
                charges.add(new Charge(pmsCustomerId, pmsCardId, amountMinorUnits, currency, reservationRef));
                n = charges.size();
            }
            if (release != null && n == 1) {
                entered.countDown();
                try {
                    if (!release.await(10, java.util.concurrent.TimeUnit.SECONDS)) {
                        throw new IllegalStateException("test never released the held charge");
                    }
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    throw new IllegalStateException(e);
                }
            }
            // Unique like real Mews PaymentIds; the suffix keeps the order readable.
            String paymentId = next == PmsChargeStatus.FAILED ? null : "mews-pay-" + n + "-" + RUN;
            return new PmsChargeResult(paymentId, next, next.name(), amountMinorUnits, currency);
        }

        @Override public Optional<String> getReservationState(String reservationRef) {
            return Optional.of(reservationState);
        }

        @Override public PmsPropertyConfiguration getPropertyConfiguration() {
            throw new UnsupportedOperationException();
        }

        @Override public PmsCustomer findOrCreateCustomer(PmsCustomerRef ref) {
            throw new UnsupportedOperationException();
        }

        @Override public List<PmsStoredCard> getStoredCards(String pmsCustomerId) {
            throw new UnsupportedOperationException();
        }

        record Charge(String customerId, String cardId, long amountMinor, String currency, String reservationId) {}
    }
}
