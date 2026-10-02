package com.bliss.b2b.api;

import com.bliss.b2b.BlissConfiguration.AppConfig;
import com.bliss.b2b.auth.MerchantPrincipal;
import com.bliss.b2b.domain.ConnectStatus;
import com.bliss.b2b.domain.Merchant;
import com.bliss.b2b.domain.StripeConnection;
import com.bliss.b2b.integration.EmailService;
import com.bliss.b2b.integration.EmailTemplates;
import com.bliss.b2b.integration.StripeConnectService;
import com.bliss.b2b.integration.StripeConnectService.AccountLinkResponse;
import com.bliss.b2b.integration.StripeConnectStandardService;
import com.bliss.b2b.integration.StripeNotConfiguredException;
import com.bliss.b2b.persistence.MerchantDao;
import com.bliss.b2b.persistence.MerchantStripeConnectionDao;
import com.bliss.b2b.service.PropertyOnboardingService;
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
    private final MerchantStripeConnectionDao stripeConnectionDao;
    private final PropertyOnboardingService onboardingService;
    private final java.time.Clock clock;
    /** Hold mode: where payout.* events are recorded. Null leaves them acknowledged only. */
    private com.bliss.b2b.persistence.PayoutReleaseDao payouts;
    /** Sends each payout email once. Null sends none. */
    private com.bliss.b2b.persistence.EmailLogDao emailLog;

    public StripeConnectResource(
            StripeConnectService stripe,
            MerchantDao merchantDao,
            EmailService emailService,
            AppConfig appConfig,
            MerchantStripeConnectionDao stripeConnectionDao,
            PropertyOnboardingService onboardingService,
            java.time.Clock clock
    ) {
        this.stripe = stripe;
        this.merchantDao = merchantDao;
        this.emailService = emailService;
        this.appConfig = appConfig;
        this.stripeConnectionDao = stripeConnectionDao;
        this.onboardingService = onboardingService;
        this.clock = clock;
    }

    @POST
    @Path("/stripe/connect/account-link")
    @Consumes(MediaType.APPLICATION_JSON)
    public Response createAccountLink(@Auth MerchantPrincipal principal) {
        Merchant merchant = principal.merchant();
        // A demo property never gets a real Stripe account; it uses demo-complete.
        if (!stripe.isLiveFor(merchant)) {
            return notConfigured();
        }
        try {
            String stripeAccountId = merchant.stripeConnectAccountId();
            if (stripeAccountId == null || stripeAccountId.isBlank()) {
                stripeAccountId = stripe.createConnectAccount(merchant);
                merchantDao.setStripeAccountId(merchant.id(), stripeAccountId);
                merchantDao.updateStripeConnectStatus(merchant.id(), ConnectStatus.IN_PROGRESS.wire());
            }
            // Stripe returns the merchant to their dashboard, not the consumer portal.
            String returnUrl = appConfig.getMerchantBaseUrl() + "/onboarding/stripe-return";
            String refreshUrl = appConfig.getMerchantBaseUrl() + "/onboarding/stripe-return?refresh=1";
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
        if (stripe.isLiveFor(principal.merchant())) {
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
            String accountId = accountIdOf(event);
            if (accountId == null) {
                log.warn("account.updated event {} carries no account id; ignored", event.getId());
                return Response.ok(Map.of("received", true)).build();
            }
            // Apply the live account, not the event's copy. The event's object
            // only deserializes when its API version matches the library's
            // pinned one, and it did not for events sent under the account's
            // own version: those were acknowledged and never applied. Reading
            // the account back also means a late or out-of-order event can
            // never write stale state.
            Account account;
            try {
                account = stripe.fetchAccount(accountId);
            } catch (StripeException e) {
                log.warn("Could not read Stripe account {} for event {}: {}; asking Stripe to retry",
                        accountId, event.getId(), e.getMessage());
                return Response.status(500).entity(Map.of("error", "account_unavailable")).build();
            }
            handleAccountUpdated(account);
        }
        if (event.getType() != null && event.getType().startsWith("payout.")) {
            recordPayout(event);
        }
        return Response.ok(Map.of("received", true)).build();
    }

    /** Records payout.* events on hold-mode properties' connected accounts. */
    public StripeConnectResource withPayouts(com.bliss.b2b.persistence.PayoutReleaseDao payouts) {
        this.payouts = payouts;
        return this;
    }

    /** As above, and emails the hotel when a payout is paid or fails, once each. */
    public StripeConnectResource withPayouts(com.bliss.b2b.persistence.PayoutReleaseDao payouts,
            com.bliss.b2b.persistence.EmailLogDao emailLog) {
        this.payouts = payouts;
        this.emailLog = emailLog;
        return this;
    }

    /**
     * A payout from a property's connected account to its bank (hold mode).
     * Read from the event's raw JSON, like account.updated, so the event's API
     * version doesn't matter. Events for accounts Bliss doesn't know are
     * acknowledged and ignored.
     */
    void recordPayout(Event event) {
        if (payouts == null || event.getAccount() == null || event.getDataObjectDeserializer() == null) {
            return;
        }
        String raw = event.getDataObjectDeserializer().getRawJson();
        try {
            com.fasterxml.jackson.databind.JsonNode p = JSON.readTree(raw);
            java.util.Optional<com.bliss.b2b.domain.Merchant> merchant =
                    merchantDao.findByStripeAccountId(event.getAccount());
            if (merchant.isEmpty() || p.path("id").asText("").isEmpty()) {
                return;
            }
            java.time.LocalDate arrival = p.hasNonNull("arrival_date")
                    ? java.time.Instant.ofEpochSecond(p.get("arrival_date").asLong())
                            .atZone(java.time.ZoneOffset.UTC).toLocalDate()
                    : null;
            String status = p.path("status").asText(event.getType().substring("payout.".length()));
            String currency = p.path("currency").asText("").toUpperCase(java.util.Locale.ROOT);
            String failure = p.hasNonNull("failure_message") ? p.get("failure_message").asText() : null;
            payouts.upsertPayout(merchant.get().id(), p.get("id").asText(), p.path("amount").asLong(),
                    currency, status, arrival, failure);
            boolean failed = "failed".equals(status);
            if (emailLog != null && ("paid".equals(status) || failed) && merchant.get().email() != null
                    && emailLog.claim("payout:" + p.get("id").asText() + ":" + status, "payout_" + status,
                            merchant.get().email()) == 1) {
                emailService.send(com.bliss.b2b.integration.EmailTemplates.payoutUpdate(merchant.get(),
                        p.path("amount").asLong(), currency, arrival, failed, failure));
            }
            log.info("Recorded {} {} for merchant {}", event.getType(), p.get("id").asText(), merchant.get().id());
        } catch (com.fasterxml.jackson.core.JsonProcessingException | RuntimeException e) {
            log.warn("Could not record {} {}: {}", event.getType(), event.getId(), e.toString());
        }
    }

    /**
     * The id of the account an {@code account.updated} event is about, read
     * from the event's raw JSON so it works whatever API version Stripe sent
     * the event under. Null when the event has no object id.
     */
    private static final com.fasterxml.jackson.databind.ObjectMapper JSON =
            new com.fasterxml.jackson.databind.ObjectMapper();

    static String accountIdOf(Event event) {
        if (event.getData() == null || event.getDataObjectDeserializer() == null) {
            return null;
        }
        String raw = event.getDataObjectDeserializer().getRawJson();
        if (raw == null || raw.isBlank()) {
            return null;
        }
        try {
            com.fasterxml.jackson.databind.JsonNode id = JSON.readTree(raw).get("id");
            return id == null || id.isNull() ? null : id.asText();
        } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
            return null;
        }
    }

    private void handleAccountUpdated(Account account) {
        Optional<Merchant> maybeMerchant = merchantDao.findByStripeAccountId(account.getId());
        if (maybeMerchant.isEmpty()) {
            // Not an Express account on a merchant row; it may be a per-property
            // Standard account in merchant_stripe_connections.
            if (handleStandardAccountUpdated(account)) {
                return;
            }
            log.warn("account.updated for unknown stripe account {}", account.getId());
            return;
        }
        com.bliss.b2b.service.PropertyOnboardingService.recordStripeAccountLocale(
                merchantDao, maybeMerchant.get().id(), account);
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

    /**
     * Standard-account counterpart of {@link #handleAccountUpdated}: syncs
     * {@code merchant_stripe_connections} from the account snapshot and, on the
     * transition into charges-enabled, advances the property's onboarding
     * checklist (PMS_SELECTED -> PMS_CONNECTED). Returns true when the account
     * matched a stored Standard connection.
     */
    private boolean handleStandardAccountUpdated(Account account) {
        Optional<StripeConnection> maybe = stripeConnectionDao.findByStripeAccountId(account.getId());
        if (maybe.isEmpty()) {
            return false;
        }
        StripeConnection conn = maybe.get();
        onboardingService.recordStripeAccountLocale(conn.merchantId(), account);
        ConnectStatus newStatus = StripeConnectStandardService.statusOf(account);
        boolean chargesEnabled = StripeConnectStandardService.chargesEnabled(account);
        boolean was = conn.isChargesEnabled();
        if (newStatus.wire().equals(conn.connectStatus()) && was == chargesEnabled) {
            return true;
        }
        stripeConnectionDao.updateStatus(
                conn.merchantId(), newStatus.wire(), chargesEnabled, java.time.Instant.now(clock));
        log.info("Merchant {} Stripe Standard status: {} -> {}",
                conn.merchantId(), conn.connectStatus(), newStatus.wire());
        if (!was && chargesEnabled) {
            onboardingService.markStripeConnected(conn.merchantId());
            merchantDao.findById(conn.merchantId()).ifPresent(this::sendChargesEnabledEmail);
        }
        return true;
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
