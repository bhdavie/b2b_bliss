package com.bliss.b2b.service;

import com.bliss.b2b.domain.Referral;
import com.bliss.b2b.domain.ReferralStatus;
import com.bliss.b2b.domain.Referrer;
import java.security.SecureRandom;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.Base64;
import java.util.Optional;
import java.util.UUID;
import org.jdbi.v3.core.Handle;
import org.jdbi.v3.core.Jdbi;

/**
 * Guest referrals: the public intake and the admin queue behind it.
 *
 * <p>All SQL lives here, on plain handles, matching {@link AdminMerchantsService}.
 * Each public method opens its own handle and delegates to a package-private
 * static twin that takes one, so the tests can run the real SQL inside a
 * transaction they always roll back.
 */
public class ReferralService {

    /** A second submission of the same guest and hotel inside this window collapses onto the first. */
    static final Duration DUPLICATE_WINDOW = Duration.ofDays(30);

    private static final String COLUMNS = """
            id, guest_email, guest_name, hotel_name, hotel_city, note, status,
            merchant_id, source, source_ip, referrer_id, code, clicked_at,
            created_at, updated_at
            """;

    private static final String REFERRER_COLUMNS = "id, email, code, magic_token, created_at";

    /**
     * No 0/O, 1/I/L or U. A guest reads this off a screen and a hotel retypes
     * it, so the alphabet is the part that decides whether that works.
     */
    private static final char[] CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ".toCharArray();
    private static final int CODE_LENGTH = 6;
    /** Collisions are ~1 in 729 million per attempt; this is for the birthday case at scale. */
    private static final int CODE_ATTEMPTS = 8;
    private static final SecureRandom RANDOM = new SecureRandom();

    private final Jdbi jdbi;

    public ReferralService(Jdbi jdbi) {
        this.jdbi = jdbi;
    }

    // ---------------------------------------------------------------- create

    /**
     * Records a referral, or returns the existing one when the same guest
     * already referred the same hotel within {@link #DUPLICATE_WINDOW}.
     *
     * <p>The check and the insert run in one transaction behind an advisory
     * lock keyed on the email and hotel, so two identical submissions racing
     * each other still produce one row rather than both passing the check.
     */
    public CreateResult create(NewReferral input, Instant now) {
        return jdbi.inTransaction(h -> create(h, input, now));
    }

    static CreateResult create(Handle h, NewReferral input, Instant now) {
        String email = input.guestEmail().trim().toLowerCase(Locale.ROOT);
        String hotelKey = input.hotelName().trim().toLowerCase(Locale.ROOT);

        // Transaction-scoped: released at commit or rollback, never leaked.
        h.createQuery("SELECT 1 FROM pg_advisory_xact_lock(hashtext(:key))")
                .bind("key", "referral:" + email + "|" + hotelKey)
                .mapTo(Integer.class)
                .one();

        Optional<Referral> existing = h.createQuery("SELECT " + COLUMNS + """
                FROM referrals
                WHERE guest_email = :email
                  AND lower(hotel_name) = :hotelKey
                  AND created_at >= :cutoff
                ORDER BY created_at ASC
                LIMIT 1
                """)
                .bind("email", email)
                .bind("hotelKey", hotelKey)
                .bind("cutoff", now.minus(DUPLICATE_WINDOW))
                .map((rs, ctx) -> map(rs))
                .findOne();
        if (existing.isPresent()) {
            return new CreateResult(existing.get(), false);
        }

        Referral created = h.createQuery("""
                INSERT INTO referrals
                    (guest_email, guest_name, hotel_name, hotel_city, note, source_ip,
                     referrer_id, code)
                VALUES (:email, :guestName, :hotelName, :hotelCity, :note, :sourceIp,
                        CAST(:referrerId AS uuid), :code)
                RETURNING
                """ + COLUMNS)
                .bind("email", email)
                .bind("guestName", input.guestName())
                .bind("hotelName", input.hotelName().trim())
                .bind("hotelCity", input.hotelCity().trim())
                .bind("note", input.note())
                .bind("sourceIp", input.sourceIp())
                .bind("referrerId", input.referrerId())
                .bind("code", input.code())
                .map((rs, ctx) -> map(rs))
                .one();
        return new CreateResult(created, true);
    }

    // ----------------------------------------------------------------- reads

    /** Newest first. {@code status} null means every status. */
    public List<Referral> listAll(ReferralStatus status) {
        return jdbi.withHandle(h -> listAll(h, status));
    }

    static List<Referral> listAll(Handle h, ReferralStatus status) {
        String where = status == null ? "" : "WHERE status = :status\n";
        var query = h.createQuery("SELECT " + COLUMNS + "FROM referrals\n" + where
                + "ORDER BY created_at DESC, id DESC");
        if (status != null) query.bind("status", status.wire());
        return query.map((rs, ctx) -> map(rs)).list();
    }

    public Optional<Referral> findById(UUID id) {
        return jdbi.withHandle(h -> findById(h, id));
    }

    static Optional<Referral> findById(Handle h, UUID id) {
        return h.createQuery("SELECT " + COLUMNS + "FROM referrals WHERE id = :id")
                .bind("id", id)
                .map((rs, ctx) -> map(rs))
                .findOne();
    }

    /** True when {@code merchantId} names a merchant that is not a demo account. */
    public boolean isLinkableMerchant(UUID merchantId) {
        return jdbi.withHandle(h -> isLinkableMerchant(h, merchantId));
    }

    static boolean isLinkableMerchant(Handle h, UUID merchantId) {
        return h.createQuery("""
                SELECT EXISTS (SELECT 1 FROM merchants WHERE id = :id AND is_demo = false)
                """)
                .bind("id", merchantId)
                .mapTo(Boolean.class)
                .one();
    }

    // ---------------------------------------------------------------- update

    /**
     * Moves a referral to {@code next}, optionally linking a merchant.
     *
     * <p>The row is locked for the read, so the transition is checked against
     * the status actually being overwritten and two admins cannot both move it
     * from the same starting point. A null {@code merchantId} leaves any
     * existing link in place; it does not clear it.
     *
     * <p>Does not validate the merchant. The resource does that first, so a bad
     * merchant is a 400 regardless of whether the transition would also fail.
     */
    public UpdateResult updateStatus(UUID id, ReferralStatus next, UUID merchantId) {
        return jdbi.inTransaction(h -> updateStatus(h, id, next, merchantId));
    }

    static UpdateResult updateStatus(Handle h, UUID id, ReferralStatus next, UUID merchantId) {
        Optional<ReferralStatus> current = h.createQuery(
                        "SELECT status FROM referrals WHERE id = :id FOR UPDATE")
                .bind("id", id)
                .map((rs, ctx) -> ReferralStatus.fromWire(rs.getString("status")))
                .findOne();
        if (current.isEmpty()) {
            return new UpdateResult(UpdateOutcome.NOT_FOUND, null, null);
        }
        if (!current.get().canTransitionTo(next)) {
            return new UpdateResult(UpdateOutcome.CONFLICT, findById(h, id).orElse(null), current.get());
        }
        Referral updated = h.createQuery("""
                UPDATE referrals
                SET status = :status,
                    merchant_id = COALESCE(CAST(:merchantId AS uuid), merchant_id)
                WHERE id = :id
                RETURNING
                """ + COLUMNS)
                .bind("id", id)
                .bind("status", next.wire())
                // A null binds untyped (as varchar), which COALESCE will not
                // match against uuid; the CAST in the SQL is what types it.
                .bind("merchantId", merchantId)
                .map((rs, ctx) -> map(rs))
                .one();
        return new UpdateResult(UpdateOutcome.UPDATED, updated, current.get());
    }

    // ------------------------------------------------------------- referrers

    /**
     * ATTRIBUTION: FIRST CLICK WINS. The single copy of this rule on the
     * backend; the website states it again in lib/referrals.ts for the readers
     * who only ever see that side.
     *
     * <p>A hotel is credited to the first referrer whose link it opened. Once a
     * referral row exists for a code, later clicks on that same link update
     * {@code clicked_at} and never open a second row. Clicks from a DIFFERENT
     * referrer's link are recorded against that second referrer, on their own
     * row, and do not move credit off the first: nothing in this class ever
     * rewrites {@code referrer_id}.
     *
     * <p>Which of two competing rows is "first" is decided at the point a
     * merchant is linked, by {@link #firstClickHolder}, comparing clicked_at.
     * The admin resource asks before linking.
     */

    /**
     * The referrer for {@code email}, created if this is the first time we have
     * seen it. Idempotent: the same address always gets the same code back, so
     * a guest asking twice never ends up with two links.
     *
     * <p>ON CONFLICT rather than check-then-insert, so two concurrent requests
     * for a new address settle on one row instead of one of them failing.
     */
    public Referrer startReferrer(String email, Instant now) {
        return jdbi.inTransaction(h -> startReferrer(h, email, now));
    }

    static Referrer startReferrer(Handle h, String email, Instant now) {
        String normalised = email.trim().toLowerCase(Locale.ROOT);
        Optional<Referrer> existing = findReferrerByEmail(h, normalised);
        if (existing.isPresent()) return existing.get();

        for (int attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
            Optional<Referrer> created = h.createQuery("""
                    INSERT INTO referrers (email, code, magic_token)
                    VALUES (:email, :code, :token)
                    ON CONFLICT DO NOTHING
                    RETURNING
                    """ + REFERRER_COLUMNS)
                    .bind("email", normalised)
                    .bind("code", newCode())
                    .bind("token", newMagicToken())
                    .map((rs, ctx) -> mapReferrer(rs))
                    .findOne();
            if (created.isPresent()) return created.get();

            // ON CONFLICT DO NOTHING covers both unique indexes, so nothing
            // came back for one of two reasons: another request inserted this
            // email first, or the code collided. Email wins the lookup; a
            // collision falls through and tries another code.
            Optional<Referrer> raced = findReferrerByEmail(h, normalised);
            if (raced.isPresent()) return raced.get();
        }
        throw new IllegalStateException(
                "Could not allocate a unique referral code after " + CODE_ATTEMPTS + " attempts");
    }

    static Optional<Referrer> findReferrerByEmail(Handle h, String normalisedEmail) {
        return h.createQuery("SELECT " + REFERRER_COLUMNS + " FROM referrers WHERE email = :email")
                .bind("email", normalisedEmail)
                .map((rs, ctx) -> mapReferrer(rs))
                .findOne();
    }

    public Optional<Referrer> findReferrerByCode(String code) {
        return jdbi.withHandle(h -> findReferrerByCode(h, code));
    }

    static Optional<Referrer> findReferrerByCode(Handle h, String code) {
        if (code == null) return Optional.empty();
        return h.createQuery("SELECT " + REFERRER_COLUMNS + " FROM referrers WHERE code = :code")
                .bind("code", code.trim().toUpperCase(Locale.ROOT))
                .map((rs, ctx) -> mapReferrer(rs))
                .findOne();
    }

    public Optional<Referrer> findReferrerById(UUID id) {
        return jdbi.withHandle(h -> h.createQuery(
                        "SELECT " + REFERRER_COLUMNS + " FROM referrers WHERE id = :id")
                .bind("id", id)
                .map((rs, ctx) -> mapReferrer(rs))
                .findOne());
    }

    public Optional<Referrer> findReferrerByToken(String token) {
        return jdbi.withHandle(h -> findReferrerByToken(h, token));
    }

    static Optional<Referrer> findReferrerByToken(Handle h, String token) {
        if (token == null || token.isBlank()) return Optional.empty();
        return h.createQuery("SELECT " + REFERRER_COLUMNS + " FROM referrers WHERE magic_token = :token")
                .bind("token", token.trim())
                .map((rs, ctx) -> mapReferrer(rs))
                .findOne();
    }

    /** Newest first. Admin only: these rows carry the guest's email. */
    public List<Referrer> listReferrers() {
        return jdbi.withHandle(h -> h.createQuery(
                        "SELECT " + REFERRER_COLUMNS + " FROM referrers ORDER BY created_at DESC, id DESC")
                .map((rs, ctx) -> mapReferrer(rs))
                .list());
    }

    /** Everything this referrer has open or settled, newest first. */
    public List<Referral> listByReferrer(UUID referrerId) {
        return jdbi.withHandle(h -> h.createQuery("SELECT " + COLUMNS + """
                        FROM referrals WHERE referrer_id = :id
                        ORDER BY created_at DESC, id DESC
                        """)
                .bind("id", referrerId)
                .map((rs, ctx) -> map(rs))
                .list());
    }

    // ---------------------------------------------------------------- clicks

    /**
     * Records that a hotel opened {@code code}'s link.
     *
     * <p>Finds the referrer's open unidentified referral or opens one. A second
     * click on the same link lands on the same row: clicked_at is only written
     * the first time, because it records the FIRST visit, and the status moves
     * to CLICKED only from SUBMITTED so a later click cannot walk the ladder
     * backwards.
     *
     * <p>Empty when the code matches no referrer. The caller answers a bad code
     * exactly as it answers a missing one, so the endpoint cannot be used to
     * test whether a code exists.
     */
    public Optional<Referral> recordClick(String code, Instant now) {
        return jdbi.inTransaction(h -> {
            Optional<Referrer> referrer = findReferrerByCode(h, code);
            if (referrer.isEmpty()) return Optional.empty();
            return Optional.of(recordClick(h, referrer.get(), now));
        });
    }

    static Referral recordClick(Handle h, Referrer referrer, Instant now) {
        // Serialises two clicks on the same link; the partial unique index is
        // the backstop if this is ever bypassed.
        h.createQuery("SELECT 1 FROM pg_advisory_xact_lock(hashtext(:key))")
                .bind("key", "referrer:" + referrer.id())
                .mapTo(Integer.class)
                .one();

        Optional<Referral> open = h.createQuery("SELECT " + COLUMNS + """
                FROM referrals
                WHERE referrer_id = :id
                  AND hotel_name IS NULL
                  AND status NOT IN ('credited', 'declined')
                ORDER BY created_at ASC
                LIMIT 1
                """)
                .bind("id", referrer.id())
                .map((rs, ctx) -> map(rs))
                .findOne();

        if (open.isPresent()) {
            return h.createQuery("""
                    UPDATE referrals
                    SET clicked_at = COALESCE(clicked_at, :now),
                        status = CASE WHEN status = 'submitted' THEN 'clicked' ELSE status END
                    WHERE id = :id
                    RETURNING
                    """ + COLUMNS)
                    .bind("id", open.get().id())
                    .bind("now", now)
                    .map((rs, ctx) -> map(rs))
                    .one();
        }
        return h.createQuery("""
                INSERT INTO referrals
                    (guest_email, status, source, referrer_id, code, clicked_at)
                VALUES (:email, 'clicked', 'referral_link', :referrerId, :code, :now)
                RETURNING
                """ + COLUMNS)
                .bind("email", referrer.email())
                .bind("referrerId", referrer.id())
                .bind("code", referrer.code())
                .bind("now", now)
                .map((rs, ctx) -> map(rs))
                .one();
    }

    /**
     * Moves {@code code}'s open referral to DEMO_BOOKED, for the Calendly
     * handoff. Forward-only, so a referral already past this rung is left where
     * it is and returned unchanged.
     */
    public Optional<Referral> markDemoBooked(String code, Instant now) {
        return jdbi.inTransaction(h -> {
            Optional<Referrer> referrer = findReferrerByCode(h, code);
            if (referrer.isEmpty()) return Optional.empty();
            Referral open = recordClick(h, referrer.get(), now);
            if (!open.status().canTransitionTo(ReferralStatus.DEMO_BOOKED)) {
                return Optional.of(open);
            }
            return Optional.of(h.createQuery("""
                    UPDATE referrals SET status = 'demo_booked' WHERE id = :id
                    RETURNING
                    """ + COLUMNS)
                    .bind("id", open.id())
                    .map((rs, ctx) -> map(rs))
                    .one());
        });
    }

    /**
     * The referral that owns credit for {@code merchantId}, if one already
     * does. The admin resource calls this before linking a merchant to a second
     * referral, so first click wins across competing referrers.
     */
    public Optional<Referral> firstClickHolder(UUID merchantId) {
        return jdbi.withHandle(h -> h.createQuery("SELECT " + COLUMNS + """
                        FROM referrals
                        WHERE merchant_id = :merchantId
                        ORDER BY clicked_at ASC NULLS LAST, created_at ASC
                        LIMIT 1
                        """)
                .bind("merchantId", merchantId)
                .map((rs, ctx) -> map(rs))
                .findOne());
    }

    // ------------------------------------------------------------ generators

    static String newCode() {
        StringBuilder sb = new StringBuilder(CODE_LENGTH);
        for (int i = 0; i < CODE_LENGTH; i++) {
            sb.append(CODE_ALPHABET[RANDOM.nextInt(CODE_ALPHABET.length)]);
        }
        return sb.toString();
    }

    /** 32 bytes, URL-safe and unpadded, so it drops straight into a path segment. */
    static String newMagicToken() {
        byte[] bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    // --------------------------------------------------------------- mapping

    private static Referral map(ResultSet rs) throws SQLException {
        return new Referral(
                (UUID) rs.getObject("id"),
                rs.getString("guest_email"),
                rs.getString("guest_name"),
                rs.getString("hotel_name"),
                rs.getString("hotel_city"),
                rs.getString("note"),
                ReferralStatus.fromWire(rs.getString("status")),
                (UUID) rs.getObject("merchant_id"),
                rs.getString("source"),
                rs.getString("source_ip"),
                (UUID) rs.getObject("referrer_id"),
                rs.getString("code"),
                instantOrNull(rs, "clicked_at"),
                rs.getTimestamp("created_at").toInstant(),
                rs.getTimestamp("updated_at").toInstant());
    }

    private static Referrer mapReferrer(ResultSet rs) throws SQLException {
        return new Referrer(
                (UUID) rs.getObject("id"),
                rs.getString("email"),
                rs.getString("code"),
                rs.getString("magic_token"),
                rs.getTimestamp("created_at").toInstant());
    }

    private static Instant instantOrNull(ResultSet rs, String column) throws SQLException {
        var ts = rs.getTimestamp(column);
        return ts == null ? null : ts.toInstant();
    }

    // ----------------------------------------------------------------- types

    /**
     * Already validated and trimmed by the resource; email is lowercased here.
     *
     * <p>{@code referrerId} and {@code code} are null for a V28-style
     * submission, where a guest named a hotel without ever taking a link. They
     * are set when /start is given a hotel, so that referral is attributed to
     * the referrer it was created alongside.
     */
    public record NewReferral(
            String guestEmail, String guestName, String hotelName, String hotelCity,
            String note, String sourceIp, UUID referrerId, String code) {

        /** Unattributed, for the original public intake endpoint. */
        public NewReferral(String guestEmail, String guestName, String hotelName,
                String hotelCity, String note, String sourceIp) {
            this(guestEmail, guestName, hotelName, hotelCity, note, sourceIp, null, null);
        }
    }

    /** {@code created} false means an existing referral inside the duplicate window was returned. */
    public record CreateResult(Referral referral, boolean created) {}

    public enum UpdateOutcome { UPDATED, NOT_FOUND, CONFLICT }

    /**
     * {@code referral} is the row after the update, or as it stands on a
     * conflict. {@code previous} is the status that was checked against.
     */
    public record UpdateResult(UpdateOutcome outcome, Referral referral, ReferralStatus previous) {}
}
