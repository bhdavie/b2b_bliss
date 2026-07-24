package com.bliss.b2b.domain;

import java.time.Instant;
import java.util.UUID;

/**
 * A property's Stripe Connect *Standard* account. When {@code chargesEnabled} is
 * true the property has finished Stripe-hosted onboarding and every charge for
 * it runs as a direct charge on {@code stripeAccountId} (the property is the
 * merchant of record).
 *
 * <p>Distinct from the Express integration on the {@link Merchant} row
 * ({@code stripeConnectAccountId} / {@code stripeConnectStatus}); this is the
 * new per-property Standard rail and lives in its own table.
 */
public record StripeConnection(
        UUID merchantId,
        String stripeAccountId,
        String connectStatus,
        boolean chargesEnabled,
        Instant connectedAt,
        Instant createdAt,
        Instant updatedAt
) {
    /** True once the property can take direct charges on its connected account. */
    public boolean isChargesEnabled() {
        return chargesEnabled;
    }
}
