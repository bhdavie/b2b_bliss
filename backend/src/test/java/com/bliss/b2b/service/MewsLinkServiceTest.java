package com.bliss.b2b.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import com.bliss.b2b.BlissConfiguration.AppConfig;
import com.bliss.b2b.BlissConfiguration.PmsConfig.MewsPmsConfig;
import com.bliss.b2b.domain.MewsConnection;
import com.bliss.b2b.integration.EmailMessage;
import com.bliss.b2b.integration.EmailService;
import com.bliss.b2b.integration.pms.MewsAdapter;
import com.bliss.b2b.integration.pms.MewsAdapter.MewsCardPayment;
import com.bliss.b2b.integration.pms.MewsAdapter.MewsReservation;
import com.bliss.b2b.integration.pms.MewsAdapterFactory;
import com.bliss.b2b.integration.pms.PmsCustomer;
import com.bliss.b2b.integration.pms.PmsStoredCard;
import com.bliss.b2b.payments.PlanEligibilityService;
import com.bliss.b2b.persistence.migration.V30__Encrypt_pms_connection_tokens;
import com.bliss.b2b.security.TokenCipher;
import com.bliss.b2b.security.TokenCipher.Field;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.Statement;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashMap;
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
 * The link pass end to end against a real Postgres and a fake Mews: a Bliss-
 * rate reservation becomes a plan built on the upfront charge, a rerun changes
 * nothing, and every flag fires once.
 *
 * <p>Runs in a throwaway database created here, migrated with the real Flyway
 * scripts and dropped afterwards, so nothing touches a dev database. SKIPS
 * when Postgres is not reachable or the user cannot create databases. The
 * fake returns the shapes captured from the Gross UK demo enterprise.
 */
class MewsLinkServiceTest {

    private static final String ADMIN_URL = System.getenv().getOrDefault(
            "BLISS_TEST_DB_URL", "jdbc:postgresql://localhost:5432/bliss");
    private static final String DB_NAME = "bliss_linktest_" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);
    private static final TokenCipher CIPHER = TokenCipher.development();

    private static final String SERVICE = "svc-api-hotel";
    private static final String MONTHLY_RATE = "rate-monthly";
    private static final String BIWEEKLY_RATE = "rate-biweekly";
    private static final String OTHER_RATE = "rate-best-available";
    private static final ZoneId BUDAPEST = ZoneId.of("Europe/Budapest");

    private static Jdbi jdbi;
    private static String dbUrl;

    private MutableClock clock;
    private FakeMews mews;
    private List<EmailMessage> emails;
    private MewsLinkService service;
    private UUID merchantId;

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
        clock = new MutableClock(Instant.parse("2026-09-27T10:00:00Z"));
        mews = new FakeMews();
        emails = new ArrayList<>();
        EmailService email = emails::add;
        AppConfig app = new AppConfig();
        PlanCreationService planCreation = new PlanCreationService(
                jdbi, new PlanEligibilityService(), null, null, email,
                new PlanNotificationService(jdbi, email, "http://localhost:3000"), clock, app);
        MewsAdapterFactory factory = new MewsAdapterFactory(jdbi, CIPHER, 0) {
            @Override
            public MewsAdapter adapterForConnection(MewsConnection connection) {
                return mews;
            }
        };
        service = new MewsLinkService(jdbi, factory, planCreation, email, clock);
        merchantId = insertMerchant();
    }

    // --- Linking -------------------------------------------------------------------

    @Test
    void buildsThePlanOnTheUpfrontCharge() {
        String res = mews.book("r1", MONTHLY_RATE, "2026-12-14", "2026-12-16", "Confirmed", 21_200);
        mews.charge(res, "pay-1", "Charged", 4_240, "card-1");

        service.runForMerchant(merchantId);

        assertThat(linkStatus(res)).isEqualTo("linked");
        Map<String, Object> booking = one("""
                SELECT total_amount_cents, appointment_date::text AS checkin, checkout_date::text AS checkout,
                       booking_source AS source, mews_rate_id, mews_confirmed_at IS NOT NULL AS confirmed, status,
                       customer_email_hint AS customer_email, service_name, service_description
                FROM bookings WHERE mews_reservation_id = :r""", res);
        assertThat(booking).containsEntry("total_amount_cents", 21_200L)
                .containsEntry("checkin", "2026-12-14")
                .containsEntry("checkout", "2026-12-16")
                .containsEntry("source", "mews_import")
                .containsEntry("mews_rate_id", MONTHLY_RATE)
                .containsEntry("confirmed", true)
                .containsEntry("status", "accepted")
                .containsEntry("customer_email", "guest-r1@example.com")
                .containsEntry("service_name", "Stay, 2 nights")
                .containsEntry("service_description", "Mews reservation 1001");

        Map<String, Object> plan = one("""
                SELECT p.status, p.frequency, p.total_amount_cents, p.deposit_amount_cents,
                       p.processing_fee_cents, p.payment_rail, cc.mews_credit_card_id, cc.last_four,
                       c.mews_customer_id
                FROM payment_plans p
                JOIN bookings b ON b.id = p.booking_id
                JOIN customer_cards cc ON cc.id = p.customer_card_id
                JOIN customers c ON c.id = p.customer_id
                WHERE b.mews_reservation_id = :r""", res);
        // No fee rate row: the 5% fallback applies, on top of the Mews total.
        assertThat(plan).containsEntry("status", "active")
                .containsEntry("frequency", "monthly")
                .containsEntry("total_amount_cents", 21_200L)
                .containsEntry("deposit_amount_cents", 4_240L)
                .containsEntry("processing_fee_cents", 1_060L)
                .containsEntry("payment_rail", "mews")
                .containsEntry("mews_credit_card_id", "card-1")
                .containsEntry("last_four", "1111")
                .containsEntry("mews_customer_id", "cust-r1");

        List<Map<String, Object>> rows = schedule(res);
        assertThat(rows.get(0)).containsEntry("kind", "deposit").containsEntry("status", "paid")
                .containsEntry("amount_cents", 4_240L).containsEntry("mews_payment_id", "pay-1");
        long installments = rows.stream().skip(1)
                .peek(r -> assertThat(r).containsEntry("kind", "installment").containsEntry("status", "scheduled"))
                .mapToLong(r -> (Long) r.get("amount_cents")).sum();
        assertThat(installments).isEqualTo(21_200 + 1_060 - 4_240);

        assertThat(emails).extracting(EmailMessage::to)
                .contains("guest-r1@example.com", ownerEmail(merchantId));
    }

    @Test
    void rerunningThePassChangesNothing() {
        String res = mews.book("r1", MONTHLY_RATE, "2026-12-14", "2026-12-16", "Confirmed", 21_200);
        mews.charge(res, "pay-1", "Charged", 4_240, "card-1");
        service.runForMerchant(merchantId);
        int emailsAfterFirst = emails.size();

        service.runForMerchant(merchantId);
        service.runForMerchant(merchantId);

        assertThat(count("SELECT count(*) FROM bookings WHERE merchant_id = :m")).isEqualTo(1);
        assertThat(count("""
                SELECT count(*) FROM payment_plans p JOIN bookings b ON b.id = p.booking_id
                WHERE b.merchant_id = :m""")).isEqualTo(1);
        assertThat(count("SELECT count(*) FROM mews_flags WHERE merchant_id = :m")).isZero();
        assertThat(emails).hasSize(emailsAfterFirst);
    }

    @Test
    void theBiweeklyRateBuildsABiweeklyPlan() {
        String res = mews.book("r1", BIWEEKLY_RATE, "2026-12-14", "2026-12-16", "Confirmed", 21_200);
        mews.charge(res, "pay-1", "Charged", 5_300, "card-1");

        service.runForMerchant(merchantId);

        assertThat(one("""
                SELECT p.frequency, p.deposit_amount_cents FROM payment_plans p
                JOIN bookings b ON b.id = p.booking_id WHERE b.mews_reservation_id = :r""", res))
                .containsEntry("frequency", "biweekly")
                .containsEntry("deposit_amount_cents", 5_300L);
    }

    @Test
    void waitsWhileTheReservationIsHeldOrTheChargeIsSettling() {
        String res = mews.book("r1", MONTHLY_RATE, "2026-12-14", "2026-12-16", "Optional", 21_200);

        service.runForMerchant(merchantId);
        assertThat(linkStatus(res)).isEqualTo("pending");

        mews.reservations.put(res, withState(mews.reservations.get(res), "Confirmed"));
        mews.charge(res, "pay-1", "Pending", 4_240, "card-1");
        service.runForMerchant(merchantId);
        assertThat(linkStatus(res)).isEqualTo("pending");

        mews.payments.get(res).set(0, payment("pay-1", "Charged", 4_240, "card-1"));
        service.runForMerchant(merchantId);
        assertThat(linkStatus(res)).isEqualTo("linked");
    }

    @Test
    void ignoresOtherRatesAndDropsBookingsCancelledBeforeLinking() {
        mews.book("r1", OTHER_RATE, "2026-12-14", "2026-12-16", "Confirmed", 21_200);
        String abandoned = mews.book("r2", MONTHLY_RATE, "2026-12-14", "2026-12-16", "Optional", 21_200);

        service.runForMerchant(merchantId);
        assertThat(count("SELECT count(*) FROM mews_reservation_links WHERE merchant_id = :m")).isEqualTo(1);

        mews.reservations.put(abandoned, withState(mews.reservations.get(abandoned), "Canceled"));
        service.runForMerchant(merchantId);

        assertThat(count("SELECT count(*) FROM mews_reservation_links WHERE merchant_id = :m")).isZero();
        assertThat(count("SELECT count(*) FROM mews_flags WHERE merchant_id = :m")).isZero();
    }

    // --- Flags ---------------------------------------------------------------------

    @Test
    void flagsNoUpfrontChargeOnceTheGraceRunsOut() {
        String res = mews.book("r1", MONTHLY_RATE, "2026-12-14", "2026-12-16", "Confirmed", 21_200);

        service.runForMerchant(merchantId);
        assertThat(linkStatus(res)).isEqualTo("pending");

        clock.advance(MewsLinkService.UPFRONT_CHARGE_GRACE.plusMinutes(1));
        service.runForMerchant(merchantId);
        service.runForMerchant(merchantId);

        assertThat(linkStatus(res)).isEqualTo("flagged");
        assertFlaggedOnce(res, "no_upfront_charge");
        assertThat(count("SELECT count(*) FROM bookings WHERE merchant_id = :m")).isZero();
    }

    @Test
    void flagsAStayThatDoesNotQualify() {
        // Eight days out: inside every lead time.
        String res = mews.book("r1", MONTHLY_RATE, "2026-10-05", "2026-10-06", "Confirmed", 10_600);
        mews.charge(res, "pay-1", "Charged", 2_120, "card-1");

        service.runForMerchant(merchantId);

        assertThat(linkStatus(res)).isEqualTo("flagged");
        assertFlaggedOnce(res, "not_eligible");
        assertThat(flagDetail(res, "not_eligible")).contains("too_close");
        assertThat(count("SELECT count(*) FROM bookings WHERE merchant_id = :m")).isZero();
    }

    @Test
    void flagsAnUpfrontChargeOnTwoCards() {
        String res = mews.book("r1", MONTHLY_RATE, "2026-12-14", "2026-12-16", "Confirmed", 21_200);
        mews.charge(res, "pay-1", "Charged", 2_000, "card-1");
        mews.charge(res, "pay-2", "Charged", 2_240, "card-2");

        service.runForMerchant(merchantId);

        assertThat(linkStatus(res)).isEqualTo("flagged");
        assertFlaggedOnce(res, "link_failed");
        assertThat(count("SELECT count(*) FROM bookings WHERE merchant_id = :m")).isZero();
    }

    @Test
    void flagsAGuestWithNoEmail() {
        String res = mews.book("r1", MONTHLY_RATE, "2026-12-14", "2026-12-16", "Confirmed", 21_200);
        mews.charge(res, "pay-1", "Charged", 4_240, "card-1");
        mews.customers.put("cust-r1", new PmsCustomer("cust-r1", "Ana", "Guest", null));

        service.runForMerchant(merchantId);

        assertFlaggedOnce(res, "link_failed");
        assertThat(flagDetail(res, "link_failed")).contains("no email");
    }

    @Test
    void flagsDatesChangedAndThenACancellationInMews() {
        String res = mews.book("r1", MONTHLY_RATE, "2026-12-14", "2026-12-16", "Confirmed", 21_200);
        mews.charge(res, "pay-1", "Charged", 4_240, "card-1");
        service.runForMerchant(merchantId);
        assertThat(linkStatus(res)).isEqualTo("linked");

        mews.reservations.put(res, withDates(mews.reservations.get(res), "2026-12-15", "2026-12-17"));
        service.runForMerchant(merchantId);
        service.runForMerchant(merchantId);
        assertFlaggedOnce(res, "dates_changed");
        assertThat(flagDetail(res, "dates_changed"))
                .contains("Mon 14 Dec 2026 to Wed 16 Dec 2026")
                .contains("Tue 15 Dec 2026 to Thu 17 Dec 2026");

        mews.reservations.put(res, withState(mews.reservations.get(res), "Canceled"));
        service.runForMerchant(merchantId);
        service.runForMerchant(merchantId);
        assertFlaggedOnce(res, "canceled_in_mews");

        // Bliss changed nothing: same schedule, plan still active.
        assertThat(one("""
                SELECT p.status FROM payment_plans p JOIN bookings b ON b.id = p.booking_id
                WHERE b.mews_reservation_id = :r""", res)).containsEntry("status", "active");
    }

    @Test
    void displayDepositRoundsHalfUpInWholeCents() {
        assertThat(MewsLinkService.displayDepositCents(21_200, 2_000)).isEqualTo(4_240);
        assertThat(MewsLinkService.displayDepositCents(10_001, 2_500)).isEqualTo(2_500);
        assertThat(MewsLinkService.displayDepositCents(2, 2_500)).isEqualTo(1);
        assertThat(MewsLinkService.displayDepositCents(21_200, 0)).isZero();
    }

    // --- Helpers -------------------------------------------------------------------

    private void assertFlaggedOnce(String reservationId, String kind) {
        assertThat(count("SELECT count(*) FROM mews_flags WHERE merchant_id = :m AND reservation_id = '"
                + reservationId + "' AND kind = '" + kind + "' AND notified_at IS NOT NULL")).isEqualTo(1);
        assertThat(emails).filteredOn(e -> e.to().equals(ownerEmail(merchantId))
                        && e.subject().startsWith("Action needed")
                        && e.body().contains(mews.reservations.get(reservationId).number()))
                .filteredOn(e -> flagDetail(reservationId, kind).startsWith(firstLine(e.body())))
                .hasSize(1);
    }

    private static String firstLine(String body) {
        return body.strip().lines().findFirst().orElse("");
    }

    private String flagDetail(String reservationId, String kind) {
        return jdbi.withHandle(h -> h.createQuery(
                        "SELECT detail FROM mews_flags WHERE merchant_id = :m AND reservation_id = :r AND kind = :k")
                .bind("m", merchantId).bind("r", reservationId).bind("k", kind)
                .mapTo(String.class).one());
    }

    private String linkStatus(String reservationId) {
        return jdbi.withHandle(h -> h.createQuery(
                        "SELECT status FROM mews_reservation_links WHERE merchant_id = :m AND reservation_id = :r")
                .bind("m", merchantId).bind("r", reservationId)
                .mapTo(String.class).findOne().orElse(null));
    }

    private int count(String sql) {
        return jdbi.withHandle(h -> h.createQuery(sql).bind("m", merchantId).mapTo(Integer.class).one());
    }

    private Map<String, Object> one(String sql, String reservationId) {
        return jdbi.withHandle(h -> h.createQuery(sql).bind("r", reservationId).mapToMap().one());
    }

    private List<Map<String, Object>> schedule(String reservationId) {
        return jdbi.withHandle(h -> h.createQuery("""
                        SELECT s.kind, s.status, s.amount_cents, s.mews_payment_id
                        FROM payment_schedule s
                        JOIN payment_plans p ON p.id = s.payment_plan_id
                        JOIN bookings b ON b.id = p.booking_id
                        WHERE b.mews_reservation_id = :r
                        ORDER BY s.sequence""")
                .bind("r", reservationId).mapToMap().list());
    }

    private static String ownerEmail(UUID merchantId) {
        return "owner-" + merchantId + "@example.com";
    }

    private UUID insertMerchant() {
        UUID id = UUID.randomUUID();
        jdbi.useHandle(h -> {
            h.createUpdate("""
                    INSERT INTO merchants (id, slug, business_name, email, pms_type)
                    VALUES (:id, :slug, 'Test Inn', :email, 'mews')""")
                    .bind("id", id).bind("slug", "t" + id.toString().substring(0, 7))
                    .bind("email", ownerEmail(id)).execute();
            h.createUpdate("""
                    INSERT INTO merchant_mews_connections (
                        merchant_id, platform_url, client_token, access_token, enterprise_id,
                        enterprise_name, currency, validated_at, service_id, time_zone,
                        bliss_monthly_rate_id, bliss_biweekly_rate_id, linked_through_utc)
                    VALUES (:id, 'https://api.mews-demo.com', :ct, :at, 'ent', 'Test Inn', 'GBP', now(),
                        :svc, 'Europe/Budapest', :monthly, :biweekly, :mark)""")
                    .bind("id", id)
                    .bind("ct", CIPHER.encrypt(Field.MEWS_CLIENT_TOKEN, id, "ct"))
                    .bind("at", CIPHER.encrypt(Field.MEWS_ACCESS_TOKEN, id, "at"))
                    .bind("svc", SERVICE)
                    .bind("monthly", MONTHLY_RATE)
                    .bind("biweekly", BIWEEKLY_RATE)
                    .bind("mark", clock.instant().minus(Duration.ofMinutes(10)))
                    .execute();
        });
        return id;
    }

    private static MewsCardPayment payment(String id, String state, long amount, String card) {
        return new MewsCardPayment(id, state, amount, "GBP", card, Instant.parse("2026-09-27T09:58:00Z"));
    }

    /** A Mews enterprise in memory, answering only what the link pass asks. */
    private final class FakeMews extends MewsAdapter {
        final Map<String, MewsReservation> reservations = new HashMap<>();
        final Map<String, List<MewsCardPayment>> payments = new HashMap<>();
        final Map<String, Long> totals = new HashMap<>();
        final Map<String, PmsCustomer> customers = new HashMap<>();
        private int nextNumber = 1001;

        FakeMews() {
            super(new MewsPmsConfig());
        }

        /** A reservation for guest cust-{key} with card-1 and card-2 on file. Returns its id. */
        String book(String key, String rate, String checkin, String checkout, String state, long total) {
            String id = "res-" + key + "-" + merchantId.toString().substring(0, 4);
            String customer = "cust-" + key;
            reservations.put(id, new MewsReservation(id, String.valueOf(nextNumber++), state, SERVICE, rate,
                    customer, "cat-qa", "Distributor", stayStart(checkin), stayEnd(checkout),
                    clock.instant().minus(Duration.ofMinutes(2)), clock.instant()));
            payments.put(id, new ArrayList<>());
            totals.put(id, total);
            customers.put(customer, new PmsCustomer(customer, "Ana", "Guest", "guest-" + key + "@example.com"));
            return id;
        }

        void charge(String reservationId, String paymentId, String state, long amount, String card) {
            payments.get(reservationId).add(payment(paymentId, state, amount, card));
        }

        @Override
        public List<MewsReservation> getReservationsUpdated(String serviceId, Instant fromUtc, Instant toUtc) {
            return List.copyOf(reservations.values());
        }

        @Override
        public List<MewsReservation> getReservations(List<String> ids) {
            return ids.stream().map(reservations::get).filter(java.util.Objects::nonNull).toList();
        }

        @Override
        public List<MewsCardPayment> getReservationCardPayments(String reservationId) {
            return List.copyOf(payments.getOrDefault(reservationId, List.of()));
        }

        @Override
        public StayPrice getReservationTotal(String reservationId) {
            return new StayPrice(totals.get(reservationId), "GBP");
        }

        @Override
        public Optional<PmsCustomer> getCustomer(String customerId) {
            return Optional.ofNullable(customers.get(customerId));
        }

        @Override
        public List<PmsStoredCard> getStoredCards(String customerId) {
            return List.of(
                    new PmsStoredCard("card-1", customerId, "411111******1111", "Gateway", "Enabled", 2030, 12, true),
                    new PmsStoredCard("card-2", customerId, "555544******3333", "Gateway", "Enabled", 2029, 1, true));
        }
    }

    private MewsReservation withState(MewsReservation r, String state) {
        return new MewsReservation(r.id(), r.number(), state, r.serviceId(), r.rateId(), r.accountId(),
                r.categoryId(), r.origin(), r.startUtc(), r.endUtc(), r.createdUtc(), clock.instant());
    }

    private MewsReservation withDates(MewsReservation r, String checkin, String checkout) {
        return new MewsReservation(r.id(), r.number(), r.state(), r.serviceId(), r.rateId(), r.accountId(),
                r.categoryId(), r.origin(), stayStart(checkin), stayEnd(checkout), r.createdUtc(), clock.instant());
    }

    /** Check-in 15:00 and check-out 12:00 property time, as the Gross UK service has them. */
    private static Instant stayStart(String date) {
        return java.time.LocalDate.parse(date).atTime(15, 0).atZone(BUDAPEST).toInstant();
    }

    private static Instant stayEnd(String date) {
        return java.time.LocalDate.parse(date).atTime(12, 0).atZone(BUDAPEST).toInstant();
    }

    private static final class MutableClock extends Clock {
        private Instant now;

        MutableClock(Instant now) {
            this.now = now;
        }

        void advance(Duration d) {
            now = now.plus(d);
        }

        @Override
        public ZoneId getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return now;
        }
    }
}
