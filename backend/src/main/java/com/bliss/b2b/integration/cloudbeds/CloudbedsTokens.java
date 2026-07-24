package com.bliss.b2b.integration.cloudbeds;

/**
 * OAuth token set returned by Cloudbeds {@code access_token}. Cloudbeds may
 * rotate the refresh token on refresh, so callers must persist whatever comes
 * back here, not the value they sent.
 */
public record CloudbedsTokens(
        String accessToken,
        String refreshToken,
        long expiresInSeconds,
        String tokenType
) {
}
