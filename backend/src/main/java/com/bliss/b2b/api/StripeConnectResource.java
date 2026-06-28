package com.bliss.b2b.api;

import com.bliss.b2b.BlissConfiguration.AppConfig;
import com.bliss.b2b.auth.MerchantPrincipal;
import com.bliss.b2b.domain.ConnectStatus;
import com.bliss.b2b.domain.Merchant;
import com.bliss.b2b.integration.EmailService;
import com.bliss.b2b.integration.EmailTemplates;
import com.bliss.b2b.integration.StripeConnectService;
import com.bliss.b2b.integration.StripeConnectService.AccountLinkResponse;
import com.bliss.b2b.integration.StripeNotConfiguredException;
import com.bliss.b2b.persistence.MerchantDao;
import com.stripe.exception.SignatureVerificationException;
import com.stripe.exception.StripeException;
import com.stripe.model.Account;
import com.stripe.model.Event;
import io.dropwizard.auth.Auth;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.HeaderParam;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.util.Map;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

@Path("/api/v1")
@Produces(MediaType.APPLICATION_JSON)
public class StripeConnectResource {

    private static final Logger log = LoggerFactory.getLogger(StripeConnectResource.class);
    private static final java.security.SecureRandom RNG = new java.security.SecureRandom();

    private final StripeConnectService stripe;
    private final MerchantDao merchantDao;
    private final EmailService emailService;
    private final AppConfig appConfig;

    public StripeConnectResource(
            StripeConnectService stripe,
            MerchantDao merchantDao,
            EmailService emailService,
            AppConfig appConfig
    ) {
        this.stripe = stripe;
        this.merchantDao = merchantDao;
        this.emailService = emailService;
        this.appConfig = appConfig;
    }

    @POST
    @Path("/stripe/connect/account-link")
    @Consumes(MediaType.APPLICATION_JSON)
    public Response createAccountLink(@Auth MerchantPrincipal principal) {
        if (!stripe.isConfigured()) {
            return notConfigured();
        }
        Merchant merchant = principal.merchant();
        try {
            String stripeAccountId = merchant.stripeConnectAccountId();
            if (stripeAccountId == null || stripeAccountId.isBlank()) {
                stripeAccountId = stripe.createConnectAccount(merchant);
                merchantDao.setStripeAccountId(merchant.id(), stripeAccountId);
                merchantDao.updateStripeConnectStatus(merchant.id(), ConnectStatus.IN_PROGRESS.wire());
            }
            String returnUrl = appConfig.getFrontendBaseUrl() + "/onboarding/stripe-return";
            String refreshUrl = appConfig.getFrontendBaseUrl() + "/onboarding/stripe-return?refresh=1";
            AccountLinkResponse link = stripe.createAccountLink(stripeAccountId, returnUrl, refreshUrl);
            return Response.ok(new StripeAccountLinkView(link.url(), link.expiresAtEpochSeconds())).build();
        } catch (StripeNotConfiguredException e) {
            return notConfigured();
        } catch (StripeException e) {
            log.warn("Stripe AccountLink creation failed for merchant {}: {}", merchant.id(), e.getMessage());
            return Response.status(502)
                    .entity(Map.of("error", "stripe_error", "message", e.getMessage()))
                    .build();
        }
    }

    /**
     * Demo-only Connect completion. When real Stripe is not configured there is
     * no Stripe-hosted onboarding to send the merchant through, so this marks
     * the merchant {@code charges_enabled} with a synthetic {@code acct_demo_*}
     * id — mirroring the {@code cus_demo_*}/{@code pm_demo_*} convention the
     * plan-creation demo path already uses. Refuses when real Stripe IS
     * configured so production never fakes a connected account.
     */
    @POST
    @Path("/stripe/connect/demo-complete")
    @Consumes(MediaType.APPLICATION_JSON)
    public Response demoComplete(@Auth MerchantPrincipal principal) {
        if (stripe.isConfigured()) {
            return Response.status(409)
                    .entity(Map.of(
                            "error", "stripe_configured",
                            "message", "Real Stripe is configured; use the Connect onboarding flow instead."))
                    .build();
        }
        Merchant merchant = principal.merchant();
        String accountId = merchant.stripeConnectAccountId();
        if (accountId == null || accountId.isBlank()) {
            accountId = "acct_demo_" + shortHex();
            merchantDao.setStripeAccountId(merchant.id(), accountId);
        }
        merchantDao.updateStripeConnectStatus(merchant.id(), ConnectStatus.CHARGES_ENABLED.wire());
        log.info("Demo Stripe Connect completed for merchant {} (account {})", merchant.id(), accountId);
        return Response.ok(Map.of(
                "status", ConnectStatus.CHARGES_ENABLED.wire(),
                "accountId", accountId,
                "configured", false,
                "demo", true)).build();
    }

    /**
     * Stripe webhook handler. No auth; signature verified via the
     * webhook-signing secret. The endpoint must consume the raw body string
     * (not a parsed object) for signature verification.
     */
    @POST
    @Path("/stripe/webhooks")
    @Consumes(MediaType.APPLICATION_JSON)
    public Response webhook(@HeaderParam("Stripe-Signature") String signatureHeader, String payload) {
        if (!stripe.isConfigured()) {
            return notConfigured();
        }
        Event event;
        try {
            event = stripe.parseWebhookEvent(payload, signatureHeader);
        } catch (SignatureVerificationException e) {
            log.warn("Stripe webhook signature verification failed: {}", e.getMessage());
            return Response.status(400).entity(Map.of("error", "invalid_signature")).build();
        } catch (StripeNotConfiguredException e) {
            return notConfigured();
        }
        log.info("Received Stripe webhook event id={} type={}", event.getId(), event.getType());
        if ("account.updated".equals(event.getType())) {
            handleAccountUpdated(event);
        }
        return Response.ok(Map.of("received", true)).build();
    }

    private void handleAccountUpdated(Event event) {
        var deserializer = event.getDataObjectDeserializer();
        Optional<com.stripe.model.StripeObject> obj = deserializer.getObject();
        if (obj.isEmpty() || !(obj.get() instanceof Account account)) {
            log.warn("account.updated webhook missing or unexpected object on event {}", event.getId());
            return;
        }
        Optional<Merchant> maybeMerchant = merchantDao.findByStripeAccountId(account.getId());
        if (maybeMerchant.isEmpty()) {
            log.warn("account.updated for unknown stripe account {}", account.getId());
            return;
        }
        Merchant merchant = maybeMerchant.get();
        ConnectStatus newStatus = StripeConnectService.fromAccount(account);
        ConnectStatus oldStatus = ConnectStatus.fromWire(merchant.stripeConnectStatus());
        if (newStatus == oldStatus) return;
        merchantDao.updateStripeConnectStatus(merchant.id(), newStatus.wire());
        log.info("Merchant {} Stripe Connect status: {} → {}", merchant.id(), oldStatus.wire(), newStatus.wire());
        if (oldStatus != ConnectStatus.CHARGES_ENABLED && newStatus == ConnectStatus.CHARGES_ENABLED) {
            sendChargesEnabledEmail(merchant);
        }
    }

    private void sendChargesEnabledEmail(Merchant merchant) {
        try {
            emailService.send(EmailTemplates.stripeOnboardingComplete(merchant));
        } catch (Exception e) {
            log.warn("Failed to send Stripe onboarding email to {}: {}", merchant.email(), e.getMessage());
        }
    }

    private static String shortHex() {
        long n = RNG.nextLong();
        return String.format("%012x", n & 0xFFFFFFFFFFFFL);
    }

    private static Response notConfigured() {
        return Response.status(503)
                .entity(Map.of(
                        "error", "stripe_not_configured",
                        "message", "Stripe is not configured. Set STRIPE_SECRET_KEY (and STRIPE_WEBHOOK_SECRET for webhooks) on the backend."))
                .build();
    }
}
