package com.bliss.b2b.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import com.bliss.b2b.domain.PaymentPlan;
import com.bliss.b2b.domain.PaymentScheduleEntry;
import com.bliss.b2b.domain.PaymentScheduleStatus;
import com.bliss.b2b.domain.ScheduleKind;
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
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.jdbi.v3.core.Jdbi;
import org.jdbi.v3.sqlobject.SqlObjectPlugin;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

/**
 * Cancelling a Stripe plan refunds the guest in Stripe. It used to compute the
 * refund and only log it. Runs against a throwaway Postgres database with a
 * fake refunder; SKIPS without Postgres (CI provides one).
 */
class StripeCancellationRefundTest {

    private static final String ADMIN_URL = System.getenv().getOrDefault(
            "BLISS_TEST_DB_URL", "jdbc:postgresql://localhost:5432/bliss");
    private static final String DB_NAME =
            "bliss_refundtest_" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);
    private static final Instant AT = Instant.parse("2026-10-01T12:00:00Z");

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

    /** Records refunds; refuses intents listed in {@code failing}. */
    private static final class FakeRefunder implements CancellationService.StripeRefunder {
        final List<String[]> calls = new ArrayList<>();
        final Set<String> failing;

        FakeRefunder(Set<String> failing) {
            this.failing = failing;
        }

        @Override
        public long refund(String intentId, long amountMinor, String idempotencyKey) {
            calls.add(new String[] {intentId, String.valueOf(amountMinor), idempotencyKey});
            if (failing.contains(intentId)) {
                throw new IllegalStateException("card_declined_for_refund");
            }
            return amountMinor;
        }
    }

    private CancellationService service(CancellationService.StripeRefunder refunder) {
        return new CancellationService(
                jdbi.onDemand(PaymentPlanDao.class), jdbi.onDemand(PaymentScheduleDao.class),
                jdbi.onDemand(BookingDao.class),
                new MerchantPlanRulesService(jdbi.onDemand(MerchantPlanRulesDao.class)),
                null, jdbi.onDemand(GuestCreditDao.class), jdbi.onDemand(MerchantMewsConnectionDao.class),
                jdbi.onDemand(MerchantDao.class), jdbi.onDemand(CustomerDao.class), message -> { },
                refunder);
    }

    /**
     * A Stripe plan with no plan rules row (so the default FULL refund policy):
     * rows 1 and 2 paid on the given intents, rows 3 and 4 still scheduled,
     * 300.00 each.
     */
    private PaymentPlan stripePlan(String firstIntent, String secondIntent) {
        UUID id = UUID.randomUUID();
        UUID planId = jdbi.inTransaction(h -> {
            UUID merchant = h.createQuery("""
                    INSERT INTO merchants (slug, email, business_name, pms_type, currency, time_zone, locale)
                    VALUES (:slug, :email, 'Test Lodge', 'stripe', 'USD', 'America/New_York', 'en-US')
                    RETURNING id""")
                    .bind("slug", "r" + id.toString().substring(0, 8)).bind("email", id + "@lodge.test")
                    .mapTo(UUID.class).one();
            UUID booking = h.createQuery("""
                    INSERT INTO bookings (merchant_id, booking_token, service_name, total_amount_cents,
                                          appointment_date, status, booking_source, currency, time_zone, locale)
                    VALUES (:m, :token, 'Two nights', 120000, :appt, 'accepted', 'merchant_initiated',
                            'USD', 'America/New_York', 'en-US')
                    RETURNING id""")
                    .bind("m", merchant).bind("token", "tok-" + id.toString().substring(0, 12))
                    .bind("appt", LocalDate.of(2027, 3, 1)).mapTo(UUID.class).one();
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
                    .bind("start", LocalDate.of(2026, 8, 2)).bind("end", LocalDate.of(2026, 11, 2))
                    .mapTo(UUID.class).one();
            Object[][] rows = {
                    {1, "2026-08-02", "paid", firstIntent},
                    {2, "2026-09-02", "paid", secondIntent},
                    {3, "2026-10-02", "scheduled", null},
                    {4, "2026-11-02", "scheduled", null}};
            for (Object[] r : rows) {
                h.createUpdate("""
                        INSERT INTO payment_schedule (payment_plan_id, sequence, due_date, amount_cents, status,
                                                      kind, stripe_payment_intent_id)
                        VALUES (:p, :seq, :due, 30000, :status, 'installment', :pi)""")
                        .bind("p", plan).bind("seq", (int) r[0]).bind("due", LocalDate.parse((String) r[1]))
                        .bind("status", (String) r[2]).bind("pi", (String) r[3]).execute();
            }
            return plan;
        });
        return jdbi.onDemand(PaymentPlanDao.class).findById(planId).orElseThrow();
    }

    private Map<String, Object> planRow(UUID planId) {
        return jdbi.withHandle(h -> h.createQuery(
                        "SELECT status, refund_amount_cents, refunded_at IS NOT NULL AS refunded FROM payment_plans "
                                + "WHERE id = :p")
                .bind("p", planId).mapToMap().one());
    }

    private List<String> statuses(UUID planId) {
        return jdbi.withHandle(h -> h.createQuery(
                        "SELECT status FROM payment_schedule WHERE payment_plan_id = :p ORDER BY sequence")
                .bind("p", planId).mapTo(String.class).list());
    }

    @Test
    void cancellingAStripePlanRefundsWhatWasPaid_newestPaymentFirst() {
        FakeRefunder refunder = new FakeRefunder(Set.of());
        PaymentPlan plan = stripePlan("pi_first", "pi_second");

        CancellationService.CancellationOutcome outcome = service(refunder).cancel(plan, AT, "customer_initiated");

        assertThat(refunder.calls).extracting(c -> c[0] + ":" + c[1])
                .containsExactly("pi_second:30000", "pi_first:30000");
        assertThat(refunder.calls).extracting(c -> c[2])
                .containsExactly("cancel-refund:" + plan.id() + ":pi_second",
                        "cancel-refund:" + plan.id() + ":pi_first");
        assertThat(outcome.assessment().netRefundCents()).isEqualTo(60_000L);
        assertThat(outcome.assessment().refundedCents()).isEqualTo(60_000L);
        assertThat(planRow(plan.id())).containsEntry("status", "canceled")
                .containsEntry("refund_amount_cents", 60_000L).containsEntry("refunded", true);
        assertThat(statuses(plan.id())).containsExactly("paid", "paid", "canceled", "canceled");
    }

    @Test
    void cancellingTwiceReusesTheSameIdempotencyKeys() {
        FakeRefunder refunder = new FakeRefunder(Set.of());
        PaymentPlan plan = stripePlan("pi_a1", "pi_a2");

        service(refunder).cancel(plan, AT, "customer_initiated");
        service(refunder).cancel(plan, AT, "customer_initiated");

        // Stripe returns the original refund for a repeated key, so the guest
        // is refunded once however many times the cancellation runs.
        assertThat(refunder.calls).extracting(c -> c[2]).containsExactly(
                "cancel-refund:" + plan.id() + ":pi_a2", "cancel-refund:" + plan.id() + ":pi_a1",
                "cancel-refund:" + plan.id() + ":pi_a2", "cancel-refund:" + plan.id() + ":pi_a1");
        assertThat(planRow(plan.id())).containsEntry("refund_amount_cents", 60_000L);
    }

    @Test
    void aFailedRefundIsSkipped_andOnlyWhatSucceededIsRecorded() {
        FakeRefunder refunder = new FakeRefunder(Set.of("pi_bad"));
        PaymentPlan plan = stripePlan("pi_good", "pi_bad");

        CancellationService.CancellationOutcome outcome = service(refunder).cancel(plan, AT, "customer_initiated");

        assertThat(refunder.calls).hasSize(2);
        assertThat(outcome.assessment().refundedCents()).isEqualTo(30_000L);
        assertThat(planRow(plan.id())).containsEntry("refund_amount_cents", 30_000L);
    }

    @Test
    void demoPaymentsSettleWithoutCallingStripe() {
        FakeRefunder refunder = new FakeRefunder(Set.of());
        PaymentPlan plan = stripePlan("pi_demo_one", "pi_demo_two");

        CancellationService.CancellationOutcome outcome = service(refunder).cancel(plan, AT, "customer_initiated");

        assertThat(refunder.calls).isEmpty();
        assertThat(outcome.assessment().refundedCents()).isEqualTo(60_000L);
        assertThat(planRow(plan.id())).containsEntry("refund_amount_cents", 60_000L);
    }

    @Test
    void withoutStripeConfiguredNothingIsRefundedOrRecorded() {
        PaymentPlan plan = stripePlan("pi_x1", "pi_x2");

        CancellationService.CancellationOutcome outcome = service(null).cancel(plan, AT, "customer_initiated");

        assertThat(outcome.assessment().refundedCents()).isZero();
        assertThat(planRow(plan.id())).containsEntry("refunded", false).containsEntry("status", "canceled");
    }

    @Test
    void allocationTakesNewestFirst_andSumsAPayOffsSharedIntent() {
        List<PaymentScheduleEntry> schedule = List.of(
                row(1, "pi_deposit", 10_000), row(2, "pi_payoff", 30_000), row(3, "pi_payoff", 30_000),
                row(4, null, 30_000));

        LinkedHashMap<String, Long> all = CancellationService.allocateRefund(schedule, 70_000);
        LinkedHashMap<String, Long> part = CancellationService.allocateRefund(schedule, 65_000);

        assertThat(all).containsExactly(Map.entry("pi_payoff", 60_000L), Map.entry("pi_deposit", 10_000L));
        assertThat(part).containsExactly(Map.entry("pi_payoff", 60_000L), Map.entry("pi_deposit", 5_000L));
    }

    private static PaymentScheduleEntry row(int seq, String intent, long amount) {
        return new PaymentScheduleEntry(UUID.randomUUID(), UUID.randomUUID(), seq, LocalDate.of(2026, 9, seq),
                amount, PaymentScheduleStatus.PAID, ScheduleKind.INSTALLMENT, intent, null, null, 0, null,
                null, null, null);
    }

    // --- Booking types: the configurable-property outcome table ------------------

    /** Gives the plan's booking the terms a synced Bliss rate would have snapshotted. */
    private void snapshot(PaymentPlan plan, String bookingType, String termsJson, Instant freeUntil, long blissFee) {
        jdbi.useHandle(h -> {
            h.createUpdate("""
                    UPDATE bookings SET booking_type = :t, cancellation_terms = CAST(:j AS jsonb),
                                        free_cancellation_until = :u, created_at = :created
                    WHERE id = :b""")
                    .bind("t", bookingType).bind("j", termsJson).bind("u", freeUntil)
                    .bind("created", NOW.minusSeconds(30 * 86_400L))
                    .bind("b", plan.bookingId()).execute();
            h.createUpdate("UPDATE payment_plans SET processing_fee_cents = :f WHERE id = :p")
                    .bind("f", blissFee).bind("p", plan.id()).execute();
        });
    }

    private static final Instant NOW = Instant.parse("2026-10-01T12:00:00Z");
    /** 25% of the stay from booking: refundable, with no free window left. */
    private static final String QUARTER_FROM_BOOKING = """
            [{"applicability":"Creation","applicabilityOffset":"P0M0DT0H0M0S","feeExtent":"TimeUnits",
              "relativeFee":0.25}]""";

    private PaymentPlan reload(PaymentPlan plan) {
        return jdbi.onDemand(PaymentPlanDao.class).findById(plan.id()).orElseThrow();
    }

    @Test
    void aRefundableBookingCancelledBeforeItsDeadlineRefundsEverything() {
        PaymentPlan plan = stripePlan("pi_a" + UUID.randomUUID(), "pi_b" + UUID.randomUUID());
        snapshot(plan, "refundable", "[]", NOW.plusSeconds(86_400), 2_000);
        FakeRefunder refunder = new FakeRefunder(Set.of());

        CancellationService.Assessment a = service(refunder).cancel(reload(plan), NOW, "guest").assessment();

        assertThat(a.outcome()).isEqualTo("full_refund");
        assertThat(a.netRefundCents()).isEqualTo(60_000);
        assertThat(refunder.calls.stream().mapToLong(c -> Long.parseLong(c[1])).sum()).isEqualTo(60_000);
        assertThat(statuses(plan.id())).containsExactly("paid", "paid", "canceled", "canceled");
    }

    @Test
    void aRefundableBookingCancelledAfterItsDeadlineKeepsThePolicyFee_theBlissFeeWithinIt() {
        PaymentPlan plan = stripePlan("pi_a" + UUID.randomUUID(), "pi_b" + UUID.randomUUID());
        snapshot(plan, "refundable", QUARTER_FROM_BOOKING, NOW.minusSeconds(60), 2_000);
        FakeRefunder refunder = new FakeRefunder(Set.of());

        CancellationService.Assessment a = service(refunder).cancel(reload(plan), NOW, "guest").assessment();

        // 25% of the 1,200.00 stay is 300.00, the 20.00 Bliss fee within it.
        assertThat(a.outcome()).isEqualTo("penalty");
        assertThat(a.feeCents()).isEqualTo(30_000);
        assertThat(a.keptBlissFeeCents()).isEqualTo(2_000);
        assertThat(a.netRefundCents()).isEqualTo(30_000);
        assertThat(refunder.calls.stream().mapToLong(c -> Long.parseLong(c[1])).sum()).isEqualTo(30_000);
    }

    @Test
    void aNonRefundableBookingStopsItsPaymentsAndRefundsNothing() {
        PaymentPlan plan = stripePlan("pi_a" + UUID.randomUUID(), "pi_b" + UUID.randomUUID());
        snapshot(plan, "non_refundable", """
                [{"applicability":"Creation","applicabilityOffset":"P0M0DT0H0M0S","feeExtent":"TimeUnits",
                  "relativeFee":1}]""", null, 2_000);
        FakeRefunder refunder = new FakeRefunder(Set.of());

        CancellationService.Assessment a = service(refunder).cancel(reload(plan), NOW, "guest").assessment();

        assertThat(a.outcome()).isEqualTo("forfeit");
        assertThat(a.netRefundCents()).isZero();
        assertThat(refunder.calls).isEmpty();
        assertThat(planRow(plan.id())).containsEntry("status", "canceled");
        assertThat(statuses(plan.id())).containsExactly("paid", "paid", "canceled", "canceled");
    }

    @Test
    void thePreviewMatchesWhatCancellingDoes_andChangesNothing() {
        PaymentPlan plan = stripePlan("pi_a" + UUID.randomUUID(), "pi_b" + UUID.randomUUID());
        snapshot(plan, "refundable", QUARTER_FROM_BOOKING, NOW.minusSeconds(60), 2_000);
        FakeRefunder refunder = new FakeRefunder(Set.of());
        CancellationService service = service(refunder);

        CancellationService.Assessment preview = service.preview(reload(plan), NOW);

        assertThat(refunder.calls).isEmpty();
        assertThat(planRow(plan.id())).containsEntry("status", "active");
        CancellationService.Assessment done = service.cancel(reload(plan), NOW, "guest").assessment();
        assertThat(preview.netRefundCents()).isEqualTo(done.netRefundCents());
        assertThat(preview.outcome()).isEqualTo(done.outcome());
    }

    @Test
    void theGuestReadsTheOutcomeBeforeConfirming() {
        PaymentPlan plan = stripePlan("pi_a" + UUID.randomUUID(), "pi_b" + UUID.randomUUID());
        snapshot(plan, "refundable", QUARTER_FROM_BOOKING, NOW.minusSeconds(60), 2_000);
        com.bliss.b2b.domain.Booking booking = jdbi.onDemand(BookingDao.class).findById(plan.bookingId()).orElseThrow();
        com.bliss.b2b.domain.Merchant merchant = jdbi.onDemand(MerchantDao.class).findById(booking.merchantId())
                .orElseThrow();

        com.bliss.b2b.api.PublicPlanPortalView.CancellationView view =
                com.bliss.b2b.api.PublicPlanPortalView.CancellationView.from(merchant, booking,
                        service(new FakeRefunder(Set.of())).preview(reload(plan), NOW));

        assertThat(view.message()).isEqualTo("You'll get $300.00 back. $300.00 is kept under Test Lodge's "
                + "cancellation policy, including the Bliss fee of $20.00.");
        assertThat(view.asCredit()).isFalse();
        assertThat(view.message()).doesNotContain("\u2014");
    }

    @Test
    void aBookingWithoutABookingTypeFollowsThePlanRulesAsBefore() {
        PaymentPlan plan = stripePlan("pi_a" + UUID.randomUUID(), "pi_b" + UUID.randomUUID());

        CancellationService.Assessment a = service(new FakeRefunder(Set.of())).preview(reload(plan), NOW);

        assertThat(a.outcome()).isNull();
        assertThat(a.netRefundCents()).isEqualTo(60_000);
    }

    @Test
    void onAMewsStayWhatWouldGoBackBecomesCredit_andNonRefundableGivesNone() {
        PaymentPlan plan = stripePlan("pi_a" + UUID.randomUUID(), "pi_b" + UUID.randomUUID());
        snapshot(plan, "refundable", "[]", NOW.plusSeconds(86_400), 2_000);
        jdbi.useHandle(h -> h.createUpdate("UPDATE bookings SET mews_reservation_id = 'res-1' WHERE id = :b")
                .bind("b", plan.bookingId()).execute());
        CancellationService service = service(new FakeRefunder(Set.of()));

        CancellationService.Assessment refundable = service.preview(reload(plan), NOW);
        assertThat(refundable.creditCents()).isEqualTo(60_000);
        assertThat(refundable.netRefundCents()).isZero();

        snapshot(plan, "non_refundable", "[]", null, 2_000);
        CancellationService.Assessment nonRefundable = service.preview(reload(plan), NOW);
        assertThat(nonRefundable.creditCents()).isZero();
        assertThat(nonRefundable.outcome()).isEqualTo("forfeit");
    }
}
