package com.bliss.b2b.integration;

import com.bliss.b2b.domain.StripeConnection;
import com.bliss.b2b.persistence.MerchantStripeConnectionDao;
import java.util.Optional;
import java.util.UUID;
import org.jdbi.v3.core.Jdbi;

/**
 * Resolves a property's Stripe Connect *Standard* connected account for direct
 * charges. Mirrors {@link com.bliss.b2b.integration.pms.MewsAdapterFactory}'s
 * charge-context resolver: given a merchant, return its connected account id
 * only when the property has finished onboarding ({@code charges_enabled}). It
 * returns empty otherwise, so the pay flow falls back to the platform key (its
 * current behavior) and never routes a charge to a half-onboarded account.
 *
 * <p>A returned account id is threaded into {@link StripePaymentsService} as the
 * Stripe-Account so customer creation, card attach, SetupIntents, and the first
 * charge all execute on the property's own account.
 */
public class StripeConnectResolver {

    private final MerchantStripeConnectionDao connectionDao;

    public StripeConnectResolver(Jdbi jdbi) {
        this.connectionDao = jdbi.onDemand(MerchantStripeConnectionDao.class);
    }

    StripeConnectResolver(MerchantStripeConnectionDao connectionDao) {
        this.connectionDao = connectionDao;
    }

    /**
     * The property's connected account id when it can take direct charges, else
     * empty. Empty means "use the platform key" (unchanged current behavior).
     */
    public Optional<String> resolve(UUID merchantId) {
        return connectionDao.findByMerchant(merchantId)
                .filter(StripeConnection::isChargesEnabled)
                .map(StripeConnection::stripeAccountId);
    }

    /** Null-safe convenience for call sites that pass an optional account through. */
    public String resolveOrNull(UUID merchantId) {
        return resolve(merchantId).orElse(null);
    }
}
