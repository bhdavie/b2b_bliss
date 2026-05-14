package com.bliss.b2b.integration;

import com.bliss.b2b.BlissConfiguration.StripeConfig;
import com.bliss.b2b.domain.ConnectStatus;
import com.bliss.b2b.domain.Merchant;
import com.stripe.Stripe;
import com.stripe.exception.SignatureVerificationException;
import com.stripe.exception.StripeException;
import com.stripe.model.Account;
import com.stripe.model.AccountLink;
import com.stripe.model.Event;
import com.stripe.net.Webhook;
import com.stripe.param.AccountCreateParams;
import com.stripe.param.AccountLinkCreateParams;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Wraps the Stripe Connect Express integration. When STRIPE_SECRET_KEY is
 * blank, all calls throw {@link StripeNotConfiguredException}; callers (and
 * the resource layer) translate that into a 503 with an actionable message.
 */
public class StripeConnectService {

    private static final Logger log = LoggerFactory.getLogger(StripeConnectService.class);

    private final StripeConfig config;

    public StripeConnectService(StripeConfig config) {
        this.config = config;
        if (config.isConfigured()) {
            Stripe.apiKey = config.getSecretKey();
            log.info("Stripe Connect service initialized (secret key prefix: {})",
                    config.getSecretKey().substring(0, Math.min(7, config.getSecretKey().length())));
        } else {
            log.warn("Stripe secret key not set. Connect endpoints will return 503.");
        }
    }

    public boolean isConfigured() {
        return config.isConfigured();
    }

    /**
     * Creates a Stripe Connect Express account for the merchant. Returns the
     * new acct_xxx id which should be persisted on the merchant row.
     */
    public String createConnectAccount(Merchant merchant) throws StripeException {
        requireConfigured();
        AccountCreateParams params = AccountCreateParams.builder()
                .setType(AccountCreateParams.Type.EXPRESS)
                .setEmail(merchant.email())
                .setBusinessProfile(AccountCreateParams.BusinessProfile.builder()
                        .setName(merchant.businessName())
                        .build())
                .setCapabilities(AccountCreateParams.Capabilities.builder()
                        .setCardPayments(AccountCreateParams.Capabilities.CardPayments.builder()
                                .setRequested(true).build())
                        .setTransfers(AccountCreateParams.Capabilities.Transfers.builder()
                                .setRequested(true).build())
                        .build())
                .setMetadata(java.util.Map.of(
                        "bliss_merchant_id", merchant.id().toString(),
                        "bliss_slug", merchant.slug()))
                .build();
        Account account = Account.create(params);
        log.info("Created Stripe Connect Express account {} for merchant {}", account.getId(), merchant.id());
        return account.getId();
    }

    /**
     * Returns a one-time URL the merchant uses to complete or resume Express
     * onboarding. Both return and refresh URLs come back here so the link can
     * be regenerated if it expires.
     */
    public AccountLinkResponse createAccountLink(String stripeAccountId, String returnUrl, String refreshUrl)
            throws StripeException {
        requireConfigured();
        AccountLinkCreateParams params = AccountLinkCreateParams.builder()
                .setAccount(stripeAccountId)
                .setRefreshUrl(refreshUrl)
                .setReturnUrl(returnUrl)
                .setType(AccountLinkCreateParams.Type.ACCOUNT_ONBOARDING)
                .build();
        AccountLink link = AccountLink.create(params);
        return new AccountLinkResponse(link.getUrl(), link.getExpiresAt());
    }

    public Account fetchAccount(String stripeAccountId) throws StripeException {
        requireConfigured();
        return Account.retrieve(stripeAccountId);
    }

    public static ConnectStatus fromAccount(Account account) {
        if (account == null) return ConnectStatus.NOT_STARTED;
        Account.Requirements req = account.getRequirements();
        if (req != null && req.getDisabledReason() != null && !req.getDisabledReason().isBlank()) {
            return ConnectStatus.RESTRICTED;
        }
        boolean charges = Boolean.TRUE.equals(account.getChargesEnabled());
        boolean payouts = Boolean.TRUE.equals(account.getPayoutsEnabled());
        if (charges && payouts) return ConnectStatus.CHARGES_ENABLED;
        return ConnectStatus.IN_PROGRESS;
    }

    public Event parseWebhookEvent(String payload, String signatureHeader) throws SignatureVerificationException {
        if (config.getWebhookSecret() == null || config.getWebhookSecret().isBlank()) {
            throw new StripeNotConfiguredException();
        }
        return Webhook.constructEvent(payload, signatureHeader, config.getWebhookSecret());
    }

    private void requireConfigured() {
        if (!isConfigured()) {
            throw new StripeNotConfiguredException();
        }
    }

    public record AccountLinkResponse(String url, Long expiresAtEpochSeconds) {}
}
