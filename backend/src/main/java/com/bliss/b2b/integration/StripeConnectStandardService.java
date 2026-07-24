package com.bliss.b2b.integration;

import com.bliss.b2b.BlissConfiguration.StripeConfig;
import com.bliss.b2b.domain.ConnectStatus;
import com.bliss.b2b.domain.Merchant;
import com.stripe.exception.StripeException;
import com.stripe.model.Account;
import com.stripe.model.AccountLink;
import com.stripe.param.AccountCreateParams;
import com.stripe.param.AccountLinkCreateParams;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Stripe Connect *Standard* onboarding: a property connects its OWN Stripe
 * account and becomes the merchant of record for its charges (which run as
 * direct charges on that account, see {@link StripePaymentsService}). Separate
 * from {@link StripeConnectService}, which drives the older Express integration
 * where the platform is the merchant of record; that class is unchanged.
 *
 * <p>Inert when STRIPE_SECRET_KEY is blank: every call throws
 * {@link StripeNotConfiguredException}, which the resource layer maps to a 503.
 * The platform secret key is set by {@link StripeConnectService} /
 * {@link StripePaymentsService} at construction; this service reuses it for the
 * platform-level Account and AccountLink calls.
 */
public class StripeConnectStandardService {

    private static final Logger log = LoggerFactory.getLogger(StripeConnectStandardService.class);

    private final StripeConfig config;

    public StripeConnectStandardService(StripeConfig config) {
        this.config = config;
    }

    public boolean isConfigured() {
        return config.isConfigured();
    }

    /**
     * Creates a Stripe Connect *Standard* account for the property. Returns the
     * new {@code acct_...} id, which should be persisted in
     * {@code merchant_stripe_connections}.
     */
    public String createStandardAccount(Merchant merchant) throws StripeException {
        requireConfigured();
        AccountCreateParams params = AccountCreateParams.builder()
                .setType(AccountCreateParams.Type.STANDARD)
                .setEmail(merchant.email())
                .setBusinessProfile(AccountCreateParams.BusinessProfile.builder()
                        .setName(merchant.businessName())
                        .build())
                .setMetadata(java.util.Map.of(
                        "bliss_merchant_id", merchant.id().toString(),
                        "bliss_slug", merchant.slug(),
                        "bliss_connect", "standard"))
                .build();
        Account account = Account.create(params);
        log.info("Created Stripe Connect Standard account {} for merchant {}",
                account.getId(), merchant.id());
        return account.getId();
    }

    /**
     * Returns a one-time URL the property uses to complete or resume Standard
     * onboarding. The {@code returnUrl}/{@code refreshUrl} point back at the
     * dashboard settings page so the checklist can poll status on return.
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

    /**
     * Standard-account status. Unlike the Express mapping (which also requires
     * payouts), a Standard property can take direct charges as soon as
     * {@code charges_enabled} is true; payouts are its own concern on its own
     * account.
     */
    public static ConnectStatus statusOf(Account account) {
        if (account == null) return ConnectStatus.NOT_STARTED;
        Account.Requirements req = account.getRequirements();
        if (req != null && req.getDisabledReason() != null && !req.getDisabledReason().isBlank()) {
            return ConnectStatus.RESTRICTED;
        }
        if (Boolean.TRUE.equals(account.getChargesEnabled())) {
            return ConnectStatus.CHARGES_ENABLED;
        }
        return ConnectStatus.IN_PROGRESS;
    }

    public static boolean chargesEnabled(Account account) {
        return account != null && Boolean.TRUE.equals(account.getChargesEnabled());
    }

    private void requireConfigured() {
        if (!isConfigured()) {
            throw new StripeNotConfiguredException();
        }
    }

    public record AccountLinkResponse(String url, Long expiresAtEpochSeconds) {}
}
