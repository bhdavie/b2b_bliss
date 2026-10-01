package com.bliss.b2b.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import com.bliss.b2b.BlissConfiguration.FeaturesConfig;
import com.bliss.b2b.domain.PaymentPlan;
import com.bliss.b2b.integration.EmailMessage;
import com.bliss.b2b.integration.StripeConnectResolver;
import com.bliss.b2b.integration.StripePaymentsService;
import com.bliss.b2b.persistence.BookingDao;
import com.bliss.b2b.persistence.CustomerDao;
import com.bliss.b2b.persistence.GuestCreditDao;
import com.bliss.b2b.persistence.MerchantDao;
import com.bliss.b2b.persistence.MerchantMewsConnectionDao;
import com.bliss.b2b.persistence.MerchantPlanRulesDao;
import com.bliss.b2b.persistence.PaymentPlanDao;
import com.bliss.b2b.persistence.PaymentScheduleDao;
import com.bliss.b2b.persistence.migration.V30__Encrypt_pms_connection_tokens;
import com.bliss.b2b.security.TokenCipher;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.Statement;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.jdbi.v3.core.Jdbi;
import org.jdbi.v3.sqlobject.SqlObjectPlugin;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * Hold mode end to end against a throwaway Postgres, with Stripe faked:
 * payments held until their release point and released once, less the Bliss
 * fee; cancellations funded from the platform balance, pulling back what was
 * released beyond the property's share and debiting the fee a full refund
 * leaves the property to fund (D9). SKIPS without Postgres (CI provides one).
 */
class HoldModeTest {

    private static final String ADMIN_URL = System.getenv().getOrDefault(
            "BLISS_TEST_DB_URL", "jdbc:postgresql://localhost:5432/bliss");
    private static final String DB_NAME =
            "bliss_holdtest_" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);

    private static final Instant PAID_1 = Instant.parse("2026-09-02T15:00:00Z");
    private static final Instant PAID_2 = Instant.parse("2026-10-01T15:00:00Z");
    private static final Instant NOW = Instant.parse("2026-10-01T16:00:00Z");
    private static final Instant DEADLINE = Instant.parse("2027-03-01T05:00:00Z");
    /** 3% of a 300.00 payment. */
    private static final long FEE = 900;

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

    /** A clock the test moves. */
    private static final class TestClock extends Clock {
        Instant now = NOW;

        @Override public ZoneId getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(ZoneId zone) { return this; }
        @Override public Instant instant() { return now; }
    }

    /** Stripe's transfers, reversals and debits, recorded. */
    private static final class FakeTransfers implements ReleaseService.Transfers {
        final List<String[]> transfers = new ArrayList<>();
        final List<String[]> reversals = new ArrayList<>();
        final List<String[]> debits = new ArrayList<>();

        @Override
        public String transfer(String accountId, long amountMinor, String currency, String transferGroup,
                String key, Map<String, String> metadata) {
            transfers.add(new String[] {accountId, String.valueOf(amountMinor), transferGroup, key});
            return "tr_" + transfers.size();
        }

        @Override
        public void reverse(String transferId, long amountMinor, String key) {
            reversals.add(new String[] {transferId, String.valueOf(amountMinor), key});
        }

        @Override
        public String debit(String accountId, long amountMinor, String currency, String key) {
            debits.add(new String[] {accountId, String.valueOf(amountMinor), key});
            return "tr_debit_" + debits.size();
        }
    }

    private TestClock clock;
    private FakeTransfers stripe;
    private List<EmailMessage> emails;
    private ReleaseService releases;
    private List<String[]> refunds;
    private CancellationService cancellations;

    @BeforeEach
    void wire() {
        // Each test's plans share the database; earlier tests' waiting
        // releases must not go out in this test's passes.
        jdbi.useHandle(h -> {
            h.execute("UPDATE payout_releases SET status = 'canceled' WHERE status = 'scheduled'");
            h.execute("UPDATE payment_plans SET status = 'canceled' WHERE status = 'active'");
        });
        clock = new TestClock();
        stripe = new FakeTransfers();
        emails = new ArrayList<>();
        releases = new ReleaseService(jdbi, stripe, null, emails::add, new FeaturesConfig(), clock);
        refunds = new ArrayList<>();
        cancellations = new CancellationService(
                jdbi.onDemand(PaymentPlanDao.class), jdbi.onDemand(PaymentScheduleDao.class),
                jdbi.onDemand(BookingDao.class),
                new MerchantPlanRulesService(jdbi.onDemand(MerchantPlanRulesDao.class)),
                null, jdbi.onDemand(GuestCreditDao.class), jdbi.onDemand(MerchantMewsConnectionDao.class),
                jdbi.onDemand(MerchantDao.class), jdbi.onDemand(CustomerDao.class), message -> { },
                (intentId, amount, key) -> {
                    refunds.add(new String[] {intentId, String.valueOf(amount), key});
                    return amount;
                }).withReleases(releases);
    }

    /**
     * A hold-mode Stripe plan for a USD property with an Express account and a
     * 3% Bliss fee: 4 payments of 300.00, the first two paid.
     */
    private PaymentPlan holdPlan(String bookingType, String termsJson, Instant freeUntil) {
        UUID id = UUID.randomUUID();
        UUID planId = jdbi.inTransaction(h -> {
            UUID merchant = h.createQuery("""
                    INSERT INTO merchants (slug, email, business_name, pms_type, currency, time_zone, locale,
                                           stripe_connect_account_id, stripe_connect_status, bliss_fee_percentage)
                    VALUES (:slug, :email, 'Aparium Test', 'stripe', 'USD', 'America/Detroit', 'en-US',
                            :acct, 'charges_enabled', 0.03)
                    RETURNING id""")
                    .bind("slug", "h" + id.toString().substring(0, 8)).bind("email", id + "@hotel.test")
                    .bind("acct", "acct_express_" + id.toString().substring(0, 8))
                    .mapTo(UUID.class).one();
            h.createUpdate("INSERT INTO property_bliss_settings (merchant_id, payout_mode) VALUES (:m, 'hold')")
                    .bind("m", merchant).execute();
            UUID booking = h.createQuery("""
                    INSERT INTO bookings (merchant_id, booking_token, service_name, total_amount_cents,
                                          appointment_date, status, booking_source, currency, time_zone, locale,
                                          payout_mode, booking_type, cancellation_terms, free_cancellation_until,
                                          created_at)
                    VALUES (:m, :token, 'Three nights', 120000, :appt, 'accepted', 'merchant_initiated',
                            'USD', 'America/Detroit', 'en-US', 'hold', :type, CAST(:terms AS jsonb), :free,
                            :created)
                    RETURNING id""")
                    .bind("m", merchant).bind("token", "tok-" + id.toString().substring(0, 12))
                    .bind("appt", LocalDate.of(2027, 3, 15)).bind("type", bookingType).bind("terms", termsJson)
                    .bind("free", freeUntil).bind("created", PAID_1.minus(Duration.ofDays(1)))
                    .mapTo(UUID.class).one();
            UUID customer = h.createQuery("""
                    INSERT INTO customers (email, first_name, last_name, stripe_customer_id)
                    VALUES (:email, 'Guest', 'One', :cus) RETURNING id""")
                    .bind("email", "guest-" + id + "@example.com").bind("cus", "cus_" + id.toString().substring(0, 12))
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
                    VALUES (:b, :c, :card, 120000, 4, 'monthly', :start, :end, 0, 0, 'active', 'stripe')
                    RETURNING id""")
                    .bind("b", booking).bind("c", customer).bind("card", card)
                    .bind("start", LocalDate.of(2026, 9, 2)).bind("end", LocalDate.of(2026, 12, 2))
                    .mapTo(UUID.class).one();
            Object[][] rows = {
                    {1, "2026-09-02", "paid", "pi_1_" + id, PAID_1},
                    {2, "2026-10-01", "paid", "pi_2_" + id, PAID_2},
                    {3, "2026-11-02", "scheduled", null, null},
                    {4, "2026-12-02", "scheduled", null, null}};
            for (Object[] r : rows) {
                h.createUpdate("""
                        INSERT INTO payment_schedule (payment_plan_id, sequence, due_date, amount_cents, status,
                                                      kind, stripe_payment_intent_id, paid_at)
                        VALUES (:p, :seq, :due, 30000, :status, 'installment', :pi, :paid)""")
                        .bind("p", plan).bind("seq", (int) r[0]).bind("due", LocalDate.parse((String) r[1]))
                        .bind("status", (String) r[2]).bind("pi", (String) r[3]).bind("paid", (Instant) r[4])
                        .execute();
            }
            return plan;
        });
        return jdbi.onDemand(PaymentPlanDao.class).findById(planId).orElseThrow();
    }

    private PaymentPlan refundablePlan() {
        return holdPlan("refundable", "[]", DEADLINE);
    }

    private List<Map<String, Object>> releaseRows(PaymentPlan plan) {
        return jdbi.withHandle(h -> h.createQuery("""
                        SELECT step, release_at, amount_minor, fee_minor, reversed_minor, status, stripe_transfer_id
                        FROM payout_releases WHERE payment_plan_id = :p ORDER BY release_at, step""")
                .bind("p", plan.id()).mapToMap().list());
    }

    private static long sum(List<String[]> calls) {
        return calls.stream().mapToLong(c -> Long.parseLong(c[1])).sum();
    }

    // --- Holding and releasing ----------------------------------------------

    @Test
    void aRefundableBookingsPaymentsAreHeldUntilFreeCancellationEnds_thenReleasedOnceLessTheFee() {
        PaymentPlan plan = refundablePlan();
        jdbi.useHandle(h -> h.execute("UPDATE bookings SET mews_reservation_number = '134557' WHERE id = ?",
                plan.bookingId()));

        releases.run();

        assertThat(releaseRows(plan)).hasSize(2).allSatisfy(r -> {
            assertThat(r).containsEntry("status", "scheduled").containsEntry("amount_minor", 30_000L - FEE)
                    .containsEntry("fee_minor", FEE);
            assertThat(((java.sql.Timestamp) r.get("release_at")).toInstant()).isEqualTo(DEADLINE);
        });
        assertThat(stripe.transfers).isEmpty();

        clock.now = DEADLINE.plusSeconds(60);
        releases.run();
        releases.run();

        assertThat(stripe.transfers).hasSize(2);
        assertThat(sum(stripe.transfers)).isEqualTo(2 * (30_000L - FEE));
        assertThat(stripe.transfers).allSatisfy(t -> {
            assertThat(t[0]).startsWith("acct_express_");
            assertThat(t[2]).isEqualTo("booking_" + plan.bookingId());
            assertThat(t[3]).startsWith("release:");
        });
        assertThat(releaseRows(plan)).allSatisfy(r -> assertThat(r).containsEntry("status", "released"));
        assertThat(emails).singleElement().satisfies(m -> {
            assertThat(m.subject()).isEqualTo("Your Bliss payments are on their way");
            assertThat(m.body()).contains("- Reservation 134557, Three nights, check-in")
                    .contains("$582.00").doesNotContain("—");
        });
    }

    @Test
    void aNonRefundableBookingsPaymentsAreReleasedOnCollectionAfterTheBuffer() {
        PaymentPlan plan = holdPlan("non_refundable", "[]", null);

        clock.now = PAID_2.plus(Duration.ofDays(2));
        releases.run();
        assertThat(stripe.transfers).as("the first payment is past its three day buffer").hasSize(1);

        clock.now = PAID_2.plus(Duration.ofDays(3)).plusSeconds(60);
        releases.run();
        assertThat(stripe.transfers).hasSize(2);
        assertThat(releaseRows(plan)).allSatisfy(r -> assertThat(r).containsEntry("status", "released"));
    }

    @Test
    void aHoldBookingChargesOnBehalfOfTheExpressAccount() {
        PaymentPlan plan = refundablePlan();
        UUID merchantId = jdbi.onDemand(BookingDao.class).findById(plan.bookingId()).orElseThrow().merchantId();

        StripePaymentsService.Destination d = jdbi.withHandle(h -> new StripeConnectResolver(jdbi)
                .destinationFor(h, merchantId, plan.bookingId(), "hold"));

        assertThat(d.isHold()).isTrue();
        assertThat(d.onBehalfOf()).startsWith("acct_express_");
        assertThat(d.transferGroup()).isEqualTo("booking_" + plan.bookingId());
        assertThat(d.hasAccount()).as("no destination transfer").isFalse();
    }

    // --- Cancelling ---------------------------------------------------------

    @Test
    void cancellingBeforeTheDeadlineRefundsEverything_andThePropertyFundsTheBlissFee() {
        PaymentPlan plan = refundablePlan();
        releases.run();

        CancellationService.Assessment a = cancellations.cancel(plan, NOW, "guest").assessment();

        assertThat(a.outcome()).isEqualTo("full_refund");
        assertThat(sum(refunds)).isEqualTo(60_000);
        assertThat(stripe.transfers).as("nothing was released, so nothing is sent").isEmpty();
        // D9: Bliss never gives its fee back; the property funds it.
        assertThat(stripe.debits).singleElement().satisfies(d -> {
            assertThat(d[0]).startsWith("acct_express_");
            assertThat(d[1]).isEqualTo(String.valueOf(2 * FEE));
            assertThat(d[2]).startsWith("fee-debit:");
        });
        assertThat(releaseRows(plan)).extracting(r -> r.get("step") + ":" + r.get("status"))
                .containsExactlyInAnyOrder("payment:" + scheduleId(plan, 1) + ":canceled",
                        "payment:" + scheduleId(plan, 2) + ":canceled", "fee_debit:released");

        clock.now = DEADLINE.plusSeconds(60);
        releases.run();
        assertThat(stripe.transfers).as("cancelled releases never go out").isEmpty();
    }

    @Test
    void cancellingAfterReleasePullsBackWhatGoesToTheGuest() {
        // 25% of the stay from booking: after the deadline the hotel keeps 300.00.
        PaymentPlan plan = holdPlan("refundable", """
                [{"applicability":"Creation","applicabilityOffset":"P0M0DT0H0M0S","feeExtent":"TimeUnits",
                  "relativeFee":0.25}]""", DEADLINE);
        releases.run();
        clock.now = DEADLINE.plusSeconds(60);
        releases.run();
        assertThat(sum(stripe.transfers)).isEqualTo(58_200);

        CancellationService.Assessment a = cancellations.cancel(plan, DEADLINE.plus(Duration.ofHours(1)), "guest")
                .assessment();

        // The guest gets 300.00 back. Of the 300.00 kept, Bliss keeps its 18.00
        // fee and the property 282.00, so 300.00 of the 582.00 released comes back.
        assertThat(a.outcome()).isEqualTo("penalty");
        assertThat(sum(refunds)).isEqualTo(30_000);
        assertThat(sum(stripe.reversals)).isEqualTo(30_000);
        assertThat(stripe.reversals.get(0)[0]).as("newest release first").isEqualTo("tr_2");
        assertThat(stripe.debits).isEmpty();
        long held = releaseRows(plan).stream()
                .mapToLong(r -> (long) r.get("amount_minor") - (long) r.get("reversed_minor")).sum();
        assertThat(held).isEqualTo(28_200);
    }

    @Test
    void cancellingANonRefundableBookingReleasesThePropertysShareAtOnce() {
        PaymentPlan plan = holdPlan("non_refundable", "[]", null);
        releases.run();
        assertThat(stripe.transfers).as("the first payment is already past its buffer").hasSize(1);

        cancellations.cancel(plan, NOW, "guest");

        assertThat(refunds).isEmpty();
        assertThat(sum(stripe.transfers)).as("everything but the fee").isEqualTo(60_000 - 2 * FEE);
        assertThat(releaseRows(plan)).extracting(r -> r.get("step") + ":" + r.get("status"))
                .contains("cancellation:released");
    }

    // --- Ledger payments ----------------------------------------------------

    @Test
    void aMewsStaysLedgerPaymentsWaitUntilThePaymentTypeIsChosen() {
        PaymentPlan plan = holdPlan("non_refundable", "[]", null);
        jdbi.useHandle(h -> h.createUpdate("UPDATE bookings SET mews_reservation_id = 'res-hold' WHERE id = :b")
                .bind("b", plan.bookingId()).execute());

        releases.run();

        List<Map<String, Object>> postings = jdbi.withHandle(h -> h.createQuery(
                        "SELECT kind, amount_minor, status FROM folio_postings WHERE booking_id = :b ORDER BY kind")
                .bind("b", plan.bookingId()).mapToMap().list());
        assertThat(postings).extracting(p -> p.get("kind") + ":" + p.get("amount_minor") + ":" + p.get("status"))
                .containsExactly("ledger_fee:900:pending", "ledger_payment:29100:pending");
    }

    private UUID scheduleId(PaymentPlan plan, int sequence) {
        return jdbi.withHandle(h -> h.createQuery(
                        "SELECT id FROM payment_schedule WHERE payment_plan_id = :p AND sequence = :s")
                .bind("p", plan.id()).bind("s", sequence).mapTo(UUID.class).one());
    }
}
