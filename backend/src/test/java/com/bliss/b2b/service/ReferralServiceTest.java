package com.bliss.b2b.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import com.bliss.b2b.domain.Referral;
import com.bliss.b2b.domain.ReferralStatus;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.DriverManager;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.jdbi.v3.core.Handle;
import org.jdbi.v3.core.Jdbi;
import org.jdbi.v3.sqlobject.SqlObjectPlugin;
import org.junit.jupiter.api.Test;

/**
 * The referral SQL against a real Postgres: intake, the 30-day duplicate
 * collapse, and the forward-only status write.
 *
 * <p>Same shape as {@link AdminFeeRateWriteTest}: SKIPS when no database is
 * reachable, and every test runs inside a transaction that is always rolled
 * back. If the dev database has not had V28 applied yet, the migration script
 * itself is run inside that same transaction (Postgres DDL is transactional),
 * so the test exercises the real migration and still leaves nothing behind.
 */
class ReferralServiceTest {

    private static final String URL = System.getenv().getOrDefault(
            "BLISS_TEST_DB_URL", "jdbc:postgresql://localhost:5432/bliss");

    private static Jdbi jdbiOrSkip() {
        try (Connection probe = DriverManager.getConnection(URL)) {
            assumeTrue(probe.isValid(2), "database not reachable; skipping");
        } catch (Exception e) {
            assumeTrue(false, "database not reachable (" + e.getMessage() + "); skipping");
        }
        return Jdbi.create(URL).installPlugin(new SqlObjectPlugin());
    }

    private void inRolledBackTransaction(java.util.function.Consumer<Handle> body) {
        jdbiOrSkip().useHandle(handle -> {
            handle.begin();
            try {
                ensureReferralsTable(handle);
                body.accept(handle);
            } finally {
                handle.rollback();
            }
        });
    }

    private static void ensureReferralsTable(Handle h) {
        boolean exists = h.createQuery("SELECT to_regclass('public.referrals') IS NOT NULL")
                .mapTo(Boolean.class).one();
        if (exists) return;
        try (InputStream in = ReferralServiceTest.class.getResourceAsStream(
                "/db/migration/V28__referrals.sql")) {
            assumeTrue(in != null, "V28__referrals.sql not on the classpath");
            h.createScript(new String(in.readAllBytes(), StandardCharsets.UTF_8)).execute();
        } catch (java.io.IOException e) {
            throw new RuntimeException(e);
        }
    }

    private static ReferralService.NewReferral input(String email, String hotel) {
        return new ReferralService.NewReferral(email, "Maya", hotel, "Lisbon", "Loved it", "203.0.113.7");
    }

    // ---------------------------------------------------------------- create

    @Test
    void createStoresTheReferralWithEmailLowercasedAndDefaultsApplied() {
        inRolledBackTransaction(h -> {
            ReferralService.CreateResult result = ReferralService.create(
                    h, input("  Maya.Guest@Example.COM ", "  The Lumiares  "), Instant.now());

            assertThat(result.created()).isTrue();
            Referral r = result.referral();
            assertThat(r.id()).isNotNull();
            assertThat(r.guestEmail()).isEqualTo("maya.guest@example.com");
            assertThat(r.hotelName()).isEqualTo("The Lumiares");
            assertThat(r.hotelCity()).isEqualTo("Lisbon");
            assertThat(r.status()).isEqualTo(ReferralStatus.SUBMITTED);
            assertThat(r.source()).isEqualTo("website");
            assertThat(r.sourceIp()).isEqualTo("203.0.113.7");
            assertThat(r.merchantId()).isNull();

            assertThat(ReferralService.findById(h, r.id())).contains(r);
        });
    }

    @Test
    void theStatusCheckConstraintRejectsAnUnknownStatus() {
        inRolledBackTransaction(h -> {
            UUID id = ReferralService.create(h, input("a@b.co", "Hotel"), Instant.now()).referral().id();
            h.execute("SAVEPOINT bad_status");
            try {
                h.createUpdate("UPDATE referrals SET status = 'approved' WHERE id = :id")
                        .bind("id", id).execute();
                throw new AssertionError("CHECK constraint did not fire");
            } catch (org.jdbi.v3.core.statement.UnableToExecuteStatementException expected) {
                h.execute("ROLLBACK TO SAVEPOINT bad_status");
            }
        });
    }

    // ------------------------------------------------------------ duplicates

    @Test
    void sameEmailAndHotelWithin30DaysCollapsesOntoTheFirstRow() {
        inRolledBackTransaction(h -> {
            Instant now = Instant.now();
            Referral first = ReferralService.create(h, input("maya@example.com", "The Lumiares"), now)
                    .referral();

            // Different case on both keys, different city and note: still the same referral.
            ReferralService.CreateResult again = ReferralService.create(h,
                    new ReferralService.NewReferral(
                            "MAYA@example.com", null, "the lumiares", "Porto", "again", "198.51.100.4"),
                    now);

            assertThat(again.created()).isFalse();
            assertThat(again.referral().id()).isEqualTo(first.id());
            // The first row is returned as it was; the second submission changed nothing.
            assertThat(again.referral().hotelCity()).isEqualTo("Lisbon");
            assertThat(countFor(h, "maya@example.com")).isEqualTo(1L);
        });
    }

    @Test
    void aDifferentHotelOrAnOlderReferralDoesNotCollapse() {
        inRolledBackTransaction(h -> {
            Instant now = Instant.now();
            Referral first = ReferralService.create(h, input("maya@example.com", "The Lumiares"), now)
                    .referral();

            assertThat(ReferralService.create(h, input("maya@example.com", "Casa Oliva"), now).created())
                    .isTrue();

            // Age the first one past the window: the same hotel now makes a new row.
            h.createUpdate("UPDATE referrals SET created_at = NOW() - INTERVAL '31 days' WHERE id = :id")
                    .bind("id", first.id()).execute();
            ReferralService.CreateResult later =
                    ReferralService.create(h, input("maya@example.com", "The Lumiares"), now);
            assertThat(later.created()).isTrue();
            assertThat(later.referral().id()).isNotEqualTo(first.id());
            assertThat(countFor(h, "maya@example.com")).isEqualTo(3L);
        });
    }

    // ----------------------------------------------------------------- reads

    @Test
    void listAllIsNewestFirstAndFiltersByStatus() {
        inRolledBackTransaction(h -> {
            Instant now = Instant.now();
            UUID older = ReferralService.create(h, input("one@example.com", "Hotel One"), now).referral().id();
            UUID newer = ReferralService.create(h, input("two@example.com", "Hotel Two"), now).referral().id();
            // Both rows share the transaction's NOW(); spread them so order is observable.
            h.createUpdate("UPDATE referrals SET created_at = NOW() + INTERVAL '1 hour' WHERE id = :id")
                    .bind("id", newer).execute();
            h.createUpdate("UPDATE referrals SET created_at = NOW() + INTERVAL '30 minutes' WHERE id = :id")
                    .bind("id", older).execute();
            ReferralService.updateStatus(h, older, ReferralStatus.CONTACTED, null);

            List<UUID> all = ReferralService.listAll(h, null).stream().map(Referral::id).toList();
            assertThat(all.indexOf(newer)).isLessThan(all.indexOf(older));

            List<UUID> contacted = ReferralService.listAll(h, ReferralStatus.CONTACTED)
                    .stream().map(Referral::id).toList();
            assertThat(contacted).contains(older).doesNotContain(newer);
        });
    }

    // ---------------------------------------------------------- transitions

    @Test
    void forwardMovesApplyAndBackwardMovesConflictWithoutWriting() {
        inRolledBackTransaction(h -> {
            UUID id = ReferralService.create(h, input("maya@example.com", "The Lumiares"), Instant.now())
                    .referral().id();

            ReferralService.UpdateResult live = ReferralService.updateStatus(h, id, ReferralStatus.LIVE, null);
            assertThat(live.outcome()).isEqualTo(ReferralService.UpdateOutcome.UPDATED);
            assertThat(live.previous()).isEqualTo(ReferralStatus.SUBMITTED);
            assertThat(live.referral().status()).isEqualTo(ReferralStatus.LIVE);

            ReferralService.UpdateResult back =
                    ReferralService.updateStatus(h, id, ReferralStatus.CONTACTED, null);
            assertThat(back.outcome()).isEqualTo(ReferralService.UpdateOutcome.CONFLICT);
            assertThat(back.previous()).isEqualTo(ReferralStatus.LIVE);
            assertThat(ReferralService.findById(h, id).orElseThrow().status()).isEqualTo(ReferralStatus.LIVE);

            ReferralService.UpdateResult same = ReferralService.updateStatus(h, id, ReferralStatus.LIVE, null);
            assertThat(same.outcome()).isEqualTo(ReferralService.UpdateOutcome.CONFLICT);

            assertThat(ReferralService.updateStatus(h, id, ReferralStatus.DECLINED, null).outcome())
                    .isEqualTo(ReferralService.UpdateOutcome.UPDATED);
            assertThat(ReferralService.updateStatus(h, id, ReferralStatus.CREDITED, null).outcome())
                    .isEqualTo(ReferralService.UpdateOutcome.CONFLICT);
        });
    }

    @Test
    void unknownIdIsNotFound() {
        inRolledBackTransaction(h -> assertThat(
                ReferralService.updateStatus(h, UUID.randomUUID(), ReferralStatus.CONTACTED, null).outcome())
                .isEqualTo(ReferralService.UpdateOutcome.NOT_FOUND));
    }

    @Test
    void creditedRefusesDeclineWithoutWriting() {
        inRolledBackTransaction(h -> {
            UUID id = ReferralService.create(h, input("maya@example.com", "The Lumiares"), Instant.now())
                    .referral().id();
            ReferralService.updateStatus(h, id, ReferralStatus.CREDITED, null);

            ReferralService.UpdateResult decline =
                    ReferralService.updateStatus(h, id, ReferralStatus.DECLINED, null);
            assertThat(decline.outcome()).isEqualTo(ReferralService.UpdateOutcome.CONFLICT);
            assertThat(decline.previous()).isEqualTo(ReferralStatus.CREDITED);
            assertThat(ReferralService.findById(h, id).orElseThrow().status())
                    .isEqualTo(ReferralStatus.CREDITED);
        });
    }

    @Test
    void merchantLinkIsSetWhenGivenAndKeptWhenOmitted() {
        inRolledBackTransaction(h -> {
            UUID merchantId = scratchMerchant(h, false);
            UUID id = ReferralService.create(h, input("maya@example.com", "The Lumiares"), Instant.now())
                    .referral().id();

            assertThat(ReferralService.updateStatus(h, id, ReferralStatus.LIVE, merchantId)
                    .referral().merchantId()).isEqualTo(merchantId);
            // A later move without a merchant does not clear the link.
            assertThat(ReferralService.updateStatus(h, id, ReferralStatus.CREDITED, null)
                    .referral().merchantId()).isEqualTo(merchantId);
        });
    }

    @Test
    void onlyNonDemoMerchantsAreLinkable() {
        inRolledBackTransaction(h -> {
            assertThat(ReferralService.isLinkableMerchant(h, scratchMerchant(h, false))).isTrue();
            assertThat(ReferralService.isLinkableMerchant(h, scratchMerchant(h, true))).isFalse();
            assertThat(ReferralService.isLinkableMerchant(h, UUID.randomUUID())).isFalse();
        });
    }

    // ------------------------------------------------------------- fixtures

    private static long countFor(Handle h, String email) {
        return h.createQuery("SELECT COUNT(*) FROM referrals WHERE guest_email = :e")
                .bind("e", email).mapTo(Long.class).one();
    }

    private static UUID scratchMerchant(Handle h, boolean demo) {
        return h.createQuery("""
                INSERT INTO merchants (slug, email, status, is_demo)
                VALUES (:slug, :email, 'active', :demo) RETURNING id
                """)
                .bind("slug", "referral-" + UUID.randomUUID().toString().substring(0, 8))
                .bind("email", UUID.randomUUID() + "@referral.invalid")
                .bind("demo", demo)
                .mapTo(UUID.class).one();
    }
}
