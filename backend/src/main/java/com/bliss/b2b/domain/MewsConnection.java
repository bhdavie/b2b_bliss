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
        Instant updatedAt
) {
    public boolean isValidated() {
        return validatedAt != null;
    }
}
