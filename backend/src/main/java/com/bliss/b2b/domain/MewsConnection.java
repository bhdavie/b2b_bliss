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
        // Booking setup (V31). Null until the property picks its Bliss rate.
        String serviceId,
        String blissRateId,
        String adultAgeCategoryId,
        String timeZone,
        // Bliss rates, one per payment schedule (V34). A reservation on one of
        // these is a Bliss plan on that schedule. Either may be null.
        String blissMonthlyRateId,
        String blissBiweeklyRateId,
        // Polling high-water mark: reservations updated up to here were seen.
        Instant linkedThroughUtc
) {
    public boolean isValidated() {
        return validatedAt != null;
    }

    /** True once the property has chosen what Bliss books, so checkout can create reservations. */
    public boolean isBookingSetupComplete() {
        return notBlank(serviceId) && notBlank(blissRateId)
                && notBlank(adultAgeCategoryId) && notBlank(timeZone);
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

    private static boolean notBlank(String s) {
        return s != null && !s.isBlank();
    }
}
