package com.bliss.b2b.persistence;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import com.bliss.b2b.persistence.migration.V30__Encrypt_pms_connection_tokens;
import com.bliss.b2b.security.TokenCipher;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.Statement;
import java.util.Map;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.MigrationVersion;
import org.jdbi.v3.core.Jdbi;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

/**
 * V42 against data shaped like production's: properties that finished
 * onboarding are switched on without a "Bliss is on" email, and linked
 * bookings get their Mews reservation number. Throwaway Postgres; SKIPS
 * without one.
 */
class V42MigrationTest {

    private static final String ADMIN_URL = System.getenv().getOrDefault(
            "BLISS_TEST_DB_URL", "jdbc:postgresql://localhost:5432/bliss");
    private static final String DB_NAME =
            "bliss_v42test_" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);

    private static Jdbi jdbi;
    private static String dbUrl;
    private static UUID active;
    private static UUID midSetup;
    private static UUID alreadyOn;

    private static Flyway flyway(String target) {
        return Flyway.configure().dataSource(dbUrl, null, null).locations("classpath:db/migration")
                .javaMigrations(new V30__Encrypt_pms_connection_tokens(TokenCipher.development()))
                .target(MigrationVersion.fromVersion(target)).load();
    }

    @BeforeAll
    static void migrateWithData() {
        try (Connection admin = DriverManager.getConnection(ADMIN_URL); Statement st = admin.createStatement()) {
            assumeTrue(admin.isValid(2), "database not reachable; skipping");
            st.execute("CREATE DATABASE " + DB_NAME);
        } catch (Exception e) {
            assumeTrue(false, "cannot create a test database (" + e.getMessage() + "); skipping");
        }
        int slash = ADMIN_URL.lastIndexOf('/');
        int query = ADMIN_URL.indexOf('?', slash);
        dbUrl = ADMIN_URL.substring(0, slash + 1) + DB_NAME + (query < 0 ? "" : ADMIN_URL.substring(query));
        flyway("41").migrate();
        jdbi = Jdbi.create(dbUrl);

        active = merchant("active");
        midSetup = merchant("pms_connected");
        alreadyOn = merchant("active");
        jdbi.useHandle(h -> {
            h.execute("INSERT INTO property_bliss_settings (merchant_id, bliss_enabled_at) "
                    + "VALUES (?, '2026-09-01T00:00:00Z')", alreadyOn);
            for (String[] b : new String[][] {
                    {"res-a", "Mews reservation 134557"}, {"res-b", "Mews reservation 7a05c8f2-413c"},
                    {null, "Mews reservation 99"}}) {
                h.createUpdate("""
                        INSERT INTO bookings (merchant_id, booking_token, service_name, service_description,
                                              total_amount_cents, appointment_date, status, booking_source,
                                              mews_reservation_id)
                        VALUES (:m, :t, 'Stay', :d, 10000, '2027-01-01', 'accepted', 'mews_import', :r)""")
                        .bind("m", active).bind("t", "tok-" + UUID.randomUUID()).bind("d", b[1]).bind("r", b[0])
                        .execute();
            }
        });
        flyway("42").migrate();
    }

    private static UUID merchant(String state) {
        UUID id = UUID.randomUUID();
        return jdbi.withHandle(h -> h.createQuery("""
                        INSERT INTO merchants (slug, email, business_name, pms_type, onboarding_state)
                        VALUES (:s, :e, 'Inn', 'mews', :state) RETURNING id""")
                .bind("s", "v" + id.toString().substring(0, 8)).bind("e", id + "@inn.test").bind("state", state)
                .mapTo(UUID.class).one());
    }

    @AfterAll
    static void dropDatabase() throws Exception {
        if (dbUrl == null) return;
        try (Connection admin = DriverManager.getConnection(ADMIN_URL); Statement st = admin.createStatement()) {
            st.execute("DROP DATABASE IF EXISTS " + DB_NAME + " WITH (FORCE)");
        }
    }

    private static boolean enabled(UUID merchant) {
        return jdbi.withHandle(h -> h.createQuery(
                        "SELECT count(*) FROM property_bliss_settings WHERE merchant_id = :m AND bliss_enabled_at IS NOT NULL")
                .bind("m", merchant).mapTo(Integer.class).one()) == 1;
    }

    private static boolean emailClaimed(UUID merchant) {
        return jdbi.withHandle(h -> h.createQuery("SELECT count(*) FROM email_log WHERE dedupe_key = :k")
                .bind("k", "bliss_on:" + merchant).mapTo(Integer.class).one()) == 1;
    }

    @Test
    void onboardedPropertiesAreSwitchedOnWithTheirEmailAlreadyClaimed() {
        assertThat(enabled(active)).isTrue();
        assertThat(emailClaimed(active)).as("so switching on never emails them").isTrue();
        assertThat(enabled(midSetup)).as("still setting up").isFalse();
        assertThat(emailClaimed(midSetup)).isFalse();
        String keptDate = jdbi.withHandle(h -> h.createQuery(
                        "SELECT (bliss_enabled_at AT TIME ZONE 'UTC')::date::text FROM property_bliss_settings WHERE merchant_id = :m")
                .bind("m", alreadyOn).mapTo(String.class).one());
        assertThat(keptDate).isEqualTo("2026-09-01");
    }

    @Test
    void linkedBookingsGetTheirReservationNumber() {
        Map<String, String> numbers = new java.util.HashMap<>();
        jdbi.useHandle(h -> h.createQuery(
                        "SELECT service_description, mews_reservation_number FROM bookings WHERE merchant_id = :m")
                .bind("m", active).mapToMap().forEach(r ->
                        numbers.put((String) r.get("service_description"), (String) r.get("mews_reservation_number"))));
        assertThat(numbers).containsEntry("Mews reservation 134557", "134557")
                .containsEntry("Mews reservation 7a05c8f2-413c", null)
                .containsEntry("Mews reservation 99", null);
    }
}
