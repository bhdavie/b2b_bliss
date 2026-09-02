package com.bliss.b2b.domain;

import java.time.Instant;
import java.util.UUID;

/**
 * A Bliss internal admin. Distinct from {@link Merchant}: an admin has no slug,
 * no bookings, no payout account and no onboarding state, so it is its own
 * subject rather than a flag on the merchant record.
 */
public record AdminUser(
        UUID id,
        String email,
        String name,
        Instant createdAt,
        Instant lastLoginAt
) {}
