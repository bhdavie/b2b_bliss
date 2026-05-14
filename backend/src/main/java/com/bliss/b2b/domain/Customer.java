package com.bliss.b2b.domain;

import java.time.Instant;
import java.util.UUID;

public record Customer(
        UUID id,
        String email,
        String phone,
        String firstName,
        String lastName,
        String stripeCustomerId,
        Instant lastLoginAt,
        Instant createdAt,
        Instant updatedAt
) {}
