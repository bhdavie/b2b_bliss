package com.bliss.b2b.domain;

import java.time.Instant;
import java.util.UUID;

/**
 * A property's stored Mews Connector credentials plus the enterprise identity
 * read back when the connection was validated. {@code validatedAt} is non-null
 * once {@code configuration/get} has succeeded with these tokens.
 *
 * <p>The tokens are held as stored, sealed by
 * {@link com.bliss.b2b.security.TokenCipher}; only
 * {@link com.bliss.b2b.integration.pms.MewsAdapterFactory} opens them.
 */
public record MewsConnection(
        UUID merchantId,
        String platformUrl,
        String encryptedClientToken,
        String encryptedAccessToken,
        String enterpriseId,
        String enterpriseName,
        String currency,
        Instant validatedAt,
        Instant createdAt,
        Instant updatedAt,
        // V31, from when Bliss created reservations itself. No longer read;
        // the columns stay.
        String serviceId,
        String blissRateId,
        String adultAgeCategoryId,
        String timeZone,
        // Bliss rates, one per payment schedule (V34). A reservation on one of
        // these is a Bliss plan on that schedule. Either may be null.
        String blissMonthlyRateId,
        String blissBiweeklyRateId,
        // Polling high-water mark: reservations updated up to here were seen.
        Instant linkedThroughUtc,
        // What the pop-up shows each Bliss rate charging upfront, in basis
        // points (V35). Display only; linking uses the actual Mews charge.
        Integer blissMonthlyDepositBps,
        Integer blissBiweeklyDepositBps,
        // Guests this connection may link (V37). Null links every guest; set,
        // only guests on it. Entries are full emails or "+tag" plus tags.
        java.util.List<String> linkGuestAllowlist,
        // "Gross" or "Net" (V40): how the property prices, so folio amounts are
        // sent as the matching value. Null until read from Mews.
        String pricing
) {
    /** True for a net-pricing property: tax is added on top of the amounts Bliss posts. */
    public boolean netPricing() {
        return "Net".equalsIgnoreCase(pricing);
    }

    /**
     * Whether the link pass may build a plan for this guest. With no
     * allowlist, any guest; with one, only an email on it (exact, or whose
     * local part contains a listed "+tag"), case-insensitive. A guest with no
     * email never matches a list.
     */
    public boolean allowsGuest(String email) {
        if (linkGuestAllowlist == null) {
            return true;
        }
        if (email == null || email.isBlank()) {
            return false;
        }
        String e = email.trim().toLowerCase(java.util.Locale.ROOT);
        int at = e.indexOf('@');
        String local = at < 0 ? e : e.substring(0, at);
        for (String entry : linkGuestAllowlist) {
            if (entry == null || entry.isBlank()) continue;
            String x = entry.trim().toLowerCase(java.util.Locale.ROOT);
            if (x.startsWith("+") ? local.contains(x) : e.equals(x)) {
                return true;
            }
        }
        return false;
    }

    /** True when this connection links only allowlisted guests. */
    public boolean hasGuestAllowlist() {
        return linkGuestAllowlist != null;
    }

    public boolean isValidated() {
        return validatedAt != null;
    }

    /** True once Bliss can find and link booking-engine reservations for this property. */
    public boolean isLinkingReady() {
        return isValidated() && notBlank(serviceId)
                && (notBlank(blissMonthlyRateId) || notBlank(blissBiweeklyRateId));
    }

    /**
     * The payment schedule a reservation on {@code rateId} was booked for, or
     * null when the rate is not one of this property's Bliss rates.
     */
    public com.bliss.b2b.payments.PlanFrequency frequencyForRate(String rateId) {
        if (rateId == null) return null;
        if (rateId.equals(blissMonthlyRateId)) return com.bliss.b2b.payments.PlanFrequency.MONTHLY;
        if (rateId.equals(blissBiweeklyRateId)) return com.bliss.b2b.payments.PlanFrequency.BIWEEKLY;
        return null;
    }

    /** The display deposit for a schedule's Bliss rate, in basis points, or null when unset. */
    public Integer displayDepositBpsFor(com.bliss.b2b.payments.PlanFrequency frequency) {
        if (frequency == null) return null;
        return switch (frequency) {
            case MONTHLY -> blissMonthlyDepositBps;
            case BIWEEKLY -> blissBiweeklyDepositBps;
        };
    }

    private static boolean notBlank(String s) {
        return s != null && !s.isBlank();
    }
}
