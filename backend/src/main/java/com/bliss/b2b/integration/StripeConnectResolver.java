package com.bliss.b2b.integration;

import com.bliss.b2b.domain.Merchant;
import com.bliss.b2b.domain.StripeConnection;
import com.bliss.b2b.payments.PayoutMode;
import com.bliss.b2b.persistence.MerchantDao;
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
 * <p>A returned account id is used ONLY as the {@code transfer_data.destination}
 * of a destination charge, together with {@code application_fee_amount}. It is
 * never sent as a Stripe-Account header. Every Stripe object — Customer,
 * PaymentMethod, SetupIntent, PaymentIntent — is created on the PLATFORM
 * account, because the guest's card must be vaulted platform-side to stay
 * chargeable off-session for installments 2..N; a card vaulted on a connected
 * account is siloed to that one property. See the class note on
 * {@link StripePaymentsService}.
 *
 * <p>This paragraph previously claimed the opposite — that the account id was
 * threaded in as the Stripe-Account so customer creation, card attach,
 * SetupIntents and the first charge ran on the property's own account. No call
 * site has ever done that. The claim was corrected rather than deleted because
 * it asserted a guest-flow dependency on the connected account that does not
 * exist, and that assertion is load-bearing in the wrong direction: it implies
 * removing Connect would break card vaulting, when in fact a null account id
 * only costs the transfer and the fee.
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

    /**
     * Where a booking's charge goes, by the payout mode the booking snapshotted
     * (so switching a property's mode never reroutes a booking in flight). Hold
     * mode charges on the platform {@code on_behalf_of} the property's Express
     * account (D6) and holds the money; otherwise a destination charge to the
     * Standard account, or a plain platform charge when there is none.
     */
    public StripePaymentsService.Destination destinationFor(org.jdbi.v3.core.Handle handle, UUID merchantId,
            UUID bookingId, String bookingPayoutMode) {
        MerchantDao merchants = handle.attach(MerchantDao.class);
        java.math.BigDecimal fee = merchants.findFeePercentage(merchantId).orElse(null);
        if (PayoutMode.HOLD.wire().equals(bookingPayoutMode)) {
            String express = merchants.findById(merchantId).map(Merchant::stripeConnectAccountId).orElse(null);
            return StripePaymentsService.Destination.hold(express, fee, bookingId);
        }
        return new StripePaymentsService.Destination(resolveOrNull(merchantId), fee);
    }

    /** Null-safe convenience for call sites that pass an optional account through. */
    public String resolveOrNull(UUID merchantId) {
        return resolve(merchantId).orElse(null);
    }
}
