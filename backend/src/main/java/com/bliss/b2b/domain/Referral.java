package com.bliss.b2b.domain;

import java.time.Instant;
import java.util.UUID;

/**
 * A hotel a guest wants on Bliss. One row of {@code referrals}.
 *
 * <p>Two ways in. A guest names a hotel on the marketing site, which fills
 * {@code hotelName} and {@code hotelCity} and leaves {@code referrerId} null on
 * rows predating V29. Or a hotel opens a guest's referral link, which fills
 * {@code referrerId} and {@code code} and leaves the hotel fields null until
 * the hotel identifies itself.
 *
 * <p>{@code clickedAt} is the record that the hotel opened the link, and it is
 * not the same as {@code status == CLICKED}: see {@link ReferralStatus}.
 */
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
        UUID referrerId,
        String code,
        Instant clickedAt,
        Instant createdAt,
        Instant updatedAt
) {}
