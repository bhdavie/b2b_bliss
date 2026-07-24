package com.bliss.b2b.integration.pms;

/**
 * A card vaulted against a PMS customer, returned by
 * {@link PmsAdapter#getStoredCards(String)}. Only non-sensitive metadata is
 * exposed: the full number never leaves the PMS. {@code obfuscatedNumber} is
 * masked (e.g. {@code ************1111}); {@code expiryYear}/{@code expiryMonth}
 * are parsed from the PMS "YYYY-MM" expiration and may be null if absent.
 */
public record PmsStoredCard(
        String id,
        String customerId,
        String obfuscatedNumber,
        String kind,
        String state,
        Integer expiryYear,
        Integer expiryMonth,
        boolean active) {
}
