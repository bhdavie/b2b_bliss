package com.bliss.b2b.domain;

import java.time.Instant;
import java.util.UUID;

/**
 * A property's stored Mews Connector credentials plus the enterprise identity
 * read back when the connection was validated. {@code validatedAt} is non-null
 * once {@code configuration/get} has succeeded with these tokens.
 */
public record MewsConnection(
        UUID merchantId,
        String platformUrl,
        String clientToken,
        String accessToken,
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
