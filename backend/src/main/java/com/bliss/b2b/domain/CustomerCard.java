package com.bliss.b2b.domain;

import java.time.Instant;
import java.util.UUID;

public record CustomerCard(
        UUID id,
        UUID customerId,
        String stripePaymentMethodId,
        String lastFour,
        int expMonth,
        int expYear,
        String brand,
        boolean isDefault,
        Instant createdAt,
        Instant deletedAt
) {}
