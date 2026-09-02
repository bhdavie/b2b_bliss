package com.bliss.b2b.service;

import com.bliss.b2b.persistence.MerchantFeeRateDao;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.jdbi.v3.core.Jdbi;

/**
 * Read side of the Bliss admin portal, plus the one write it owns (a new fee
 * rate). Every query here is admin-scoped: nothing is filtered by merchant,
 * because the caller IS the operator.
 *
 * <p>All SQL lives here rather than in the resource, matching the split the rest
 * of the codebase uses.
 */
public class AdminMerchantsService {

    /**
     * The flat fee every pre-V13 plan was backfilled to. Used only to suppress a
     * derived rate for those plans; see {@link #derivedRate}.
     */
    private static final long LEGACY_FLAT_FEE_CENTS = PlanCreationService.LEGACY_FLAT_FEE_CENTS;

    private final Jdbi jdbi;

    public AdminMerchantsService(Jdbi jdbi) {
        this.jdbi = jdbi;
    }

    // ------------------------------------------------------------------ list

    /**
     * Every property, newest joined first.
     *
     * <p>One query, not N+1: the effective rate comes from a LATERAL subquery
     * and the 7-day booking count from a grouped LEFT JOIN, so the row count is
     * the merchant count however many bookings or rate rows exist.
     */
    public List<MerchantRow> list(Instant now) {
        return jdbi.withHandle(h -> h.createQuery("""
                SELECT m.id, m.slug, m.business_name, m.email, m.status,
                       m.onboarding_state, m.pms_type, m.is_demo, m.created_at,
                       r.rate AS current_fee_rate,
                       COALESCE(b.recent_count, 0) AS bookings_last_7_days
                FROM merchants m
                LEFT JOIN LATERAL (
                    SELECT fr.rate
                    FROM merchant_fee_rates fr
                    WHERE fr.merchant_id = m.id
                      AND fr.effective_from <= :now
                    ORDER BY fr.effective_from DESC
                    LIMIT 1
                ) r ON TRUE
                LEFT JOIN (
                    SELECT merchant_id, COUNT(*) AS recent_count
                    FROM bookings
                    WHERE created_at >= :cutoff
                      AND status <> 'canceled'
                    GROUP BY merchant_id
                ) b ON b.merchant_id = m.id
                ORDER BY m.created_at DESC
                """)
                .bind("now", now)
                .bind("cutoff", now.minusSeconds(7L * 24 * 60 * 60))
                .map((rs, ctx) -> new MerchantRow(
                        (UUID) rs.getObject("id"),
                        rs.getString("slug"),
                        rs.getString("business_name"),
                        rs.getString("email"),
                        rs.getString("status"),
                        rs.getString("onboarding_state"),
                        rs.getString("pms_type"),
                        rs.getBoolean("is_demo"),
                        rs.getTimestamp("created_at").toInstant(),
                        rs.getBigDecimal("current_fee_rate"),
                        rs.getLong("bookings_last_7_days")))
                .list());
    }

    // ---------------------------------------------------------------- detail

    public Optional<MerchantDetail> detail(UUID merchantId, Instant now) {
        return jdbi.withHandle(h -> {
            Optional<MerchantRow> base = h.createQuery("""
                    SELECT m.id, m.slug, m.business_name, m.email, m.status,
                           m.onboarding_state, m.pms_type, m.is_demo, m.created_at,
                           r.rate AS current_fee_rate,
                           COALESCE(b.recent_count, 0) AS bookings_last_7_days
                    FROM merchants m
                    LEFT JOIN LATERAL (
                        SELECT fr.rate FROM merchant_fee_rates fr
                        WHERE fr.merchant_id = m.id AND fr.effective_from <= :now
                        ORDER BY fr.effective_from DESC LIMIT 1
                    ) r ON TRUE
                    LEFT JOIN (
                        SELECT merchant_id, COUNT(*) AS recent_count
                        FROM bookings
                        WHERE created_at >= :cutoff AND status <> 'canceled'
                        GROUP BY merchant_id
                    ) b ON b.merchant_id = m.id
                    WHERE m.id = :id
                    """)
                    .bind("id", merchantId)
                    .bind("now", now)
                    .bind("cutoff", now.minusSeconds(7L * 24 * 60 * 60))
                    .map((rs, ctx) -> new MerchantRow(
                            (UUID) rs.getObject("id"),
                            rs.getString("slug"),
                            rs.getString("business_name"),
                            rs.getString("email"),
                            rs.getString("status"),
                            rs.getString("onboarding_state"),
                            rs.getString("pms_type"),
                            rs.getBoolean("is_demo"),
                            rs.getTimestamp("created_at").toInstant(),
                            rs.getBigDecimal("current_fee_rate"),
                            rs.getLong("bookings_last_7_days")))
                    .findOne();
            if (base.isEmpty()) return Optional.<MerchantDetail>empty();

            Profile profile = h.createQuery("""
                    SELECT phone, address_line1, address_line2, address_city,
                           address_state, address_zip, address_country,
                           email_verified_at, updated_at
                    FROM merchants WHERE id = :id
                    """)
                    .bind("id", merchantId)
                    .map((rs, ctx) -> new Profile(
                            rs.getString("phone"),
                            rs.getString("address_line1"),
                            rs.getString("address_line2"),
                            rs.getString("address_city"),
                            rs.getString("address_state"),
                            rs.getString("address_zip"),
                            rs.getString("address_country"),
                            rs.getTimestamp("email_verified_at") == null
                                    ? null : rs.getTimestamp("email_verified_at").toInstant(),
                            rs.getTimestamp("updated_at").toInstant()))
                    .one();

            Counts counts = new Counts(
                    h.createQuery("SELECT COUNT(*) FROM bookings WHERE merchant_id = :id")
                            .bind("id", merchantId).mapTo(Long.class).one(),
                    groupCount(h, """
                            SELECT status, COUNT(*) FROM bookings
                            WHERE merchant_id = :id GROUP BY status ORDER BY status
                            """, merchantId),
                    h.createQuery("""
                            SELECT COUNT(*) FROM payment_plans p
                            JOIN bookings b ON b.id = p.booking_id
                            WHERE b.merchant_id = :id
                            """)
                            .bind("id", merchantId).mapTo(Long.class).one(),
                    groupCount(h, """
                            SELECT p.status, COUNT(*) FROM payment_plans p
                            JOIN bookings b ON b.id = p.booking_id
                            WHERE b.merchant_id = :id GROUP BY p.status ORDER BY p.status
                            """, merchantId));

            return Optional.of(new MerchantDetail(
                    base.get(), profile, feeRateHistory(merchantId), counts,
                    recentBookings(merchantId)));
        });
    }

    private static Map<String, Long> groupCount(org.jdbi.v3.core.Handle h, String sql, UUID id) {
        Map<String, Long> out = new LinkedHashMap<>();
        h.createQuery(sql).bind("id", id)
                .map((rs, ctx) -> Map.entry(rs.getString(1), rs.getLong(2)))
                .forEach(e -> out.put(e.getKey(), e.getValue()));
        return out;
    }

    // ------------------------------------------------------------- fee rates

    /** Newest first, including rows whose effective_from has not yet arrived. */
    public List<FeeRateRow> feeRateHistory(UUID merchantId) {
        return jdbi.withHandle(h -> h.createQuery("""
                SELECT fr.id, fr.rate, fr.effective_from, fr.note, fr.created_at,
                       a.email AS created_by_admin_email
                FROM merchant_fee_rates fr
                LEFT JOIN admin_users a ON a.id = fr.created_by_admin_id
                WHERE fr.merchant_id = :id
                ORDER BY fr.effective_from DESC, fr.created_at DESC
                """)
                .bind("id", merchantId)
                .map((rs, ctx) -> new FeeRateRow(
                        (UUID) rs.getObject("id"),
                        rs.getBigDecimal("rate"),
                        rs.getTimestamp("effective_from").toInstant(),
                        rs.getString("note"),
                        rs.getTimestamp("created_at").toInstant(),
                        rs.getString("created_by_admin_email")))
                .list());
    }

    /** The newest effective_from on record, whether or not it is in force yet. */
    public Optional<Instant> latestEffectiveFrom(UUID merchantId) {
        return jdbi.withHandle(h -> h.createQuery("""
                SELECT MAX(effective_from) FROM merchant_fee_rates WHERE merchant_id = :id
                """)
                .bind("id", merchantId)
                .mapTo(Instant.class)
                .findOne());
    }

    public boolean merchantExists(UUID merchantId) {
        return jdbi.withHandle(h -> h.createQuery(
                        "SELECT EXISTS (SELECT 1 FROM merchants WHERE id = :id)")
                .bind("id", merchantId).mapTo(Boolean.class).one());
    }

    /**
     * Appends a rate. Insert-only: nothing here updates or deletes an existing
     * row, which is what lets a plan created last month still be explained.
     */
    public FeeRateRow insertRate(
            UUID merchantId, BigDecimal rate, Instant effectiveFrom,
            String note, UUID adminUserId) {
        jdbi.useHandle(h -> h.attach(MerchantFeeRateDao.class)
                .insertRate(merchantId, rate, effectiveFrom, note, adminUserId));
        // Read back the row just written rather than echoing the input, so the
        // response carries the database's own id, created_at and scale.
        return jdbi.withHandle(h -> h.createQuery("""
                SELECT fr.id, fr.rate, fr.effective_from, fr.note, fr.created_at,
                       a.email AS created_by_admin_email
                FROM merchant_fee_rates fr
                LEFT JOIN admin_users a ON a.id = fr.created_by_admin_id
                WHERE fr.merchant_id = :id AND fr.effective_from = :ef
                ORDER BY fr.created_at DESC
                LIMIT 1
                """)
                .bind("id", merchantId)
                .bind("ef", effectiveFrom)
                .map((rs, ctx) -> new FeeRateRow(
                        (UUID) rs.getObject("id"),
                        rs.getBigDecimal("rate"),
                        rs.getTimestamp("effective_from").toInstant(),
                        rs.getString("note"),
                        rs.getTimestamp("created_at").toInstant(),
                        rs.getString("created_by_admin_email")))
                .one());
    }

    // -------------------------------------------------------------- bookings

    private List<RecentBooking> recentBookings(UUID merchantId) {
        return jdbi.withHandle(h -> h.createQuery("""
                SELECT b.id, b.booking_token, b.service_name, b.total_amount_cents,
                       b.status, b.booking_source, b.created_at, b.checkout_date,
                       b.customer_name_hint,
                       p.id AS plan_id, p.status AS plan_status, p.num_payments,
                       p.processing_fee_cents, p.total_amount_cents AS plan_total_cents
                FROM bookings b
                LEFT JOIN payment_plans p ON p.booking_id = b.id
                WHERE b.merchant_id = :id
                ORDER BY b.created_at DESC
                LIMIT 25
                """)
                .bind("id", merchantId)
                .map((rs, ctx) -> {
                    UUID planId = (UUID) rs.getObject("plan_id");
                    Long fee = planId == null ? null : rs.getLong("processing_fee_cents");
                    Long planTotal = planId == null ? null : rs.getLong("plan_total_cents");
                    java.sql.Date checkout = rs.getDate("checkout_date");
                    return new RecentBooking(
                            (UUID) rs.getObject("id"),
                            rs.getString("booking_token"),
                            rs.getString("service_name"),
                            rs.getLong("total_amount_cents"),
                            rs.getString("status"),
                            rs.getString("booking_source"),
                            rs.getTimestamp("created_at").toInstant(),
                            checkout == null ? null : checkout.toLocalDate(),
                            rs.getString("customer_name_hint"),
                            planId,
                            planId == null ? null : rs.getString("plan_status"),
                            planId == null ? null : rs.getInt("num_payments"),
                            fee,
                            derivedRate(planTotal, fee));
                })
                .list());
    }

    /**
     * The fee rate a plan was created under, recovered from what was stored.
     *
     * <p>The denominator is the PLAN total, not the booking total minus the fee.
     * The fee is added on top of the booking total
     * ({@code feeCents = round(discountedTotal * rate)}), it is not carved out
     * of it, so {@code fee / (bookingTotal - fee)} overstates the rate: on a
     * real 5% plan it returns 0.05263.
     *
     * <p>Returns null rather than a number that might be wrong in two cases:
     * <ul>
     *   <li>the implied rate does not round-trip back to the stored fee, so the
     *       fee was not a percentage of this total;
     *   <li>the fee is exactly the pre-V13 flat $20, which was never a rate at
     *       all. Those 28 plans imply rates between 0.008 and 0.023 that no one
     *       ever configured. This does mean a genuine 5% plan on a $400 total
     *       is also nulled; a false null is the safe direction here, and the
     *       authoritative record is the fee-rate history either way.
     * </ul>
     */
    static BigDecimal derivedRate(Long planTotalCents, Long feeCents) {
        if (planTotalCents == null || feeCents == null || planTotalCents <= 0) return null;
        if (feeCents == LEGACY_FLAT_FEE_CENTS) return null;
        BigDecimal rate = BigDecimal.valueOf(feeCents)
                .divide(BigDecimal.valueOf(planTotalCents), 5, RoundingMode.HALF_UP);
        long roundTrip = BigDecimal.valueOf(planTotalCents)
                .multiply(rate)
                .setScale(0, RoundingMode.HALF_UP)
                .longValueExact();
        return roundTrip == feeCents ? rate : null;
    }

    // ----------------------------------------------------------------- views

    public record MerchantRow(
            UUID id, String slug, String businessName, String email, String status,
            String onboardingState, String pmsType, boolean isDemo, Instant createdAt,
            BigDecimal currentFeeRate, long bookingsLast7Days) {}

    public record Profile(
            String phone, String addressLine1, String addressLine2, String addressCity,
            String addressState, String addressZip, String addressCountry,
            Instant emailVerifiedAt, Instant updatedAt) {}

    public record FeeRateRow(
            UUID id, BigDecimal rate, Instant effectiveFrom, String note,
            Instant createdAt, String createdByAdminEmail) {}

    public record Counts(
            long bookingsTotal, Map<String, Long> bookingsByStatus,
            long plansTotal, Map<String, Long> plansByStatus) {}

    public record RecentBooking(
            UUID id, String bookingToken, String serviceName, long totalAmountCents,
            String status, String bookingSource, Instant createdAt,
            java.time.LocalDate checkoutDate, String customerNameHint,
            UUID planId, String planStatus, Integer numPayments,
            Long processingFeeCents, BigDecimal derivedFeeRate) {}

    public record MerchantDetail(
            MerchantRow merchant, Profile profile, List<FeeRateRow> feeRateHistory,
            Counts counts, List<RecentBooking> recentBookings) {}

    /** Convenience for the resource's history endpoint. */
    public List<FeeRateRow> historyOrEmpty(UUID merchantId) {
        return merchantExists(merchantId) ? feeRateHistory(merchantId) : new ArrayList<>();
    }
}
