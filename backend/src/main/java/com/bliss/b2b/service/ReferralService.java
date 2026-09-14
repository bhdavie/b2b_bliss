package com.bliss.b2b.service;

import com.bliss.b2b.domain.Referral;
import com.bliss.b2b.domain.ReferralStatus;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Locale;
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
            merchant_id, source, source_ip, created_at, updated_at
            """;

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
                    (guest_email, guest_name, hotel_name, hotel_city, note, source_ip)
                VALUES (:email, :guestName, :hotelName, :hotelCity, :note, :sourceIp)
                RETURNING
                """ + COLUMNS)
                .bind("email", email)
                .bind("guestName", input.guestName())
                .bind("hotelName", input.hotelName().trim())
                .bind("hotelCity", input.hotelCity().trim())
                .bind("note", input.note())
                .bind("sourceIp", input.sourceIp())
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
                rs.getTimestamp("created_at").toInstant(),
                rs.getTimestamp("updated_at").toInstant());
    }

    // ----------------------------------------------------------------- types

    /** Already validated and trimmed by the resource; email is lowercased here. */
    public record NewReferral(
            String guestEmail, String guestName, String hotelName, String hotelCity,
            String note, String sourceIp) {}

    /** {@code created} false means an existing referral inside the duplicate window was returned. */
    public record CreateResult(Referral referral, boolean created) {}

    public enum UpdateOutcome { UPDATED, NOT_FOUND, CONFLICT }

    /**
     * {@code referral} is the row after the update, or as it stands on a
     * conflict. {@code previous} is the status that was checked against.
     */
    public record UpdateResult(UpdateOutcome outcome, Referral referral, ReferralStatus previous) {}
}
