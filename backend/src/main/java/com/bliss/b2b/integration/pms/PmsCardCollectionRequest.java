package com.bliss.b2b.integration.pms;

import java.time.Instant;

/**
 * A pending card-collection request created against a PMS customer, returned by
 * {@link PmsAdapter#createCardCollectionRequest}. The {@code requestId} is what
 * the frontend hands to the PMS hosted card-entry surface (for Mews, the
 * Payments Checkout embed seeded with this id); once the customer enters a card,
 * the PMS vaults it and it shows up in {@link PmsAdapter#getStoredCards}.
 */
public record PmsCardCollectionRequest(
        String requestId,
        Instant expiration,
        String description) {
}
