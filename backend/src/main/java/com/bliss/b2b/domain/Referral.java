package com.bliss.b2b.domain;

import java.time.Instant;
import java.util.UUID;

/** A guest's submission of a hotel they want on Bliss. One row of {@code referrals}. */
public record Referral(
        UUID id,
        String guestEmail,
        String guestName,
        String hotelName,
        String hotelCity,
        String note,
        ReferralStatus status,
        UUID merchantId,
        String source,
        String sourceIp,
        Instant createdAt,
        Instant updatedAt
) {}
