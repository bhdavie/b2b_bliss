package com.bliss.b2b.domain;

import java.time.Instant;
import java.util.UUID;

/**
 * A property's Cloudbeds OAuth connection: the identified {@code propertyId} plus
 * the access/refresh tokens. {@code accessTokenExpiresAt} drives the transparent
 * refresh in {@link com.bliss.b2b.integration.pms.CloudbedsAdapterFactory}.
 *
 * <p>Distinct from the Mews connection (long-lived Connector tokens) and the
 * Stripe connection (connected account); this is the OAuth rail and lives in its
 * own table.
 */
public record CloudbedsConnection(
        UUID merchantId,
        String propertyId,
        String propertyName,
        String currency,
        String accessToken,
        String refreshToken,
        Instant accessTokenExpiresAt,
        String status,
        Instant connectedAt,
        Instant createdAt,
        Instant updatedAt
) {
    /** True when the stored connection is usable (not revoked). */
    public boolean isConnected() {
        return "connected".equals(status);
    }

    /** True when the access token is at/near expiry and should be refreshed. */
    public boolean needsRefresh(Instant now, java.time.Duration skew) {
        return accessTokenExpiresAt == null
                || !now.plus(skew).isBefore(accessTokenExpiresAt);
    }
}
