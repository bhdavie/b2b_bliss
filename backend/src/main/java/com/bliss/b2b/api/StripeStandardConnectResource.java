package com.bliss.b2b.api;

import com.bliss.b2b.BlissConfiguration.AppConfig;
import com.bliss.b2b.auth.MerchantPrincipal;
import com.bliss.b2b.domain.ConnectStatus;
import com.bliss.b2b.domain.Merchant;
import com.bliss.b2b.domain.StripeConnection;
import com.bliss.b2b.integration.StripeConnectStandardService;
import com.bliss.b2b.integration.StripeConnectStandardService.AccountLinkResponse;
import com.bliss.b2b.integration.StripeNotConfiguredException;
import com.bliss.b2b.persistence.MerchantStripeConnectionDao;
import com.bliss.b2b.service.PropertyOnboardingService;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.stripe.exception.StripeException;
import com.stripe.model.Account;
import io.dropwizard.auth.Auth;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.time.Clock;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Merchant-facing Stripe Connect *Standard* onboarding. A property connects its
 * own Stripe account here and, once charges are enabled, becomes the merchant of
 * record for its charges (which run as direct charges on that account).
 *
 * <p>Separate from {@link StripeConnectResource}, which owns the older Express
 * flow ({@code /stripe/connect/*}) and the shared webhook endpoint. This
 * resource owns only the Standard {@code /merchants/stripe-connect/*} paths and
 * writes {@code merchant_stripe_connections}.
 */
@Path("/api/v1/merchants/stripe-connect")
@Produces(MediaType.APPLICATION_JSON)
public class StripeStandardConnectResource {

    private static final Logger log = LoggerFactory.getLogger(StripeStandardConnectResource.class);
    private static final java.security.SecureRandom RNG = new java.security.SecureRandom();
    private static final Set<String> ALLOWED_RETURN_PATHS =
            Set.of("/dashboard", "/onboarding/connect-stripe");

    private final StripeConnectStandardService stripe;
    private final MerchantStripeConnectionDao connectionDao;
    private final PropertyOnboardingService onboardingService;
    private final AppConfig appConfig;
    private final Clock clock;

    public StripeStandardConnectResource(
            StripeConnectStandardService stripe,
            MerchantStripeConnectionDao connectionDao,
            PropertyOnboardingService onboardingService,
            AppConfig appConfig,
            Clock clock) {
        this.stripe = stripe;
        this.connectionDao = connectionDao;
        this.onboardingService = onboardingService;
        this.appConfig = appConfig;
        this.clock = clock;
    }

    /**
     * Starts (or resumes) Standard onboarding. Creates the connected account on
     * first call, stores it, and returns a one-time Stripe-hosted onboarding URL
     * whose return/refresh links land back on the surface the merchant started
     * from (see {@link #returnPathOf}).
     */
    @POST
    @Path("/start")
    @Consumes(MediaType.APPLICATION_JSON)
    public Response start(@Auth MerchantPrincipal principal, StartRequest req) {
        if (!stripe.isConfigured()) {
            return notConfigured();
        }
        Merchant merchant = principal.merchant();
        try {
            StripeConnection existing = connectionDao.findByMerchant(merchant.id()).orElse(null);
            String accountId = existing == null ? null : existing.stripeAccountId();
            if (accountId == null || accountId.isBlank()) {
                accountId = stripe.createStandardAccount(merchant);
                connectionDao.upsertAccount(
                        merchant.id(), accountId, ConnectStatus.IN_PROGRESS.wire(), false);
            }
            String path = returnPathOf(req);
            String returnUrl = appConfig.getMerchantBaseUrl()
                    + path + "?stripe_connect=return";
            String refreshUrl = appConfig.getMerchantBaseUrl()
                    + path + "?stripe_connect=refresh";
            AccountLinkResponse link = stripe.createAccountLink(accountId, returnUrl, refreshUrl);
            return Response.ok(new StripeAccountLinkView(link.url(), link.expiresAtEpochSeconds())).build();
        } catch (StripeNotConfiguredException e) {
            return notConfigured();
        } catch (StripeException e) {
            log.warn("Stripe Standard AccountLink failed for merchant {}: {}", merchant.id(), e.getMessage());
            return Response.status(502)
                    .entity(Map.of("error", "stripe_error", "message", e.getMessage()))
                    .build();
        }
    }

    /**
     * Status for the dashboard checklist to poll. When real Stripe is configured
     * this re-fetches the live account, syncs {@code merchant_stripe_connections},
     * and (on first charges-enabled) advances onboarding PMS_SELECTED ->
     * PMS_CONNECTED. When Stripe is not configured it just reports the stored row.
     */
    @GET
    @Path("/status")
    public Response status(@Auth MerchantPrincipal principal) {
        Merchant merchant = principal.merchant();
        StripeConnection conn = connectionDao.findByMerchant(merchant.id()).orElse(null);

        if (stripe.isConfigured() && conn != null) {
            try {
                Account account = stripe.fetchAccount(conn.stripeAccountId());
                conn = syncFromAccount(merchant, conn, account);
            } catch (StripeException e) {
                log.warn("Stripe Standard status refresh failed for merchant {}: {}",
                        merchant.id(), e.getMessage());
                // Fall through and report the last stored status.
            }
        }
        return Response.ok(statusView(conn, stripe.isConfigured())).build();
    }

    /**
     * Demo-only Standard completion. When real Stripe is not configured there is
     * no Stripe-hosted onboarding to run, so this marks the property
     * charges-enabled with a synthetic {@code acct_demo_*} id (mirroring the
     * Express demo-complete convention) and advances the onboarding checklist.
     * Refuses when real Stripe IS configured so production never fakes a
     * connected account.
     */
    @POST
    @Path("/demo-complete")
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
        StripeConnection conn = connectionDao.findByMerchant(merchant.id()).orElse(null);
        String accountId = conn == null ? null : conn.stripeAccountId();
        if (accountId == null || accountId.isBlank()) {
            accountId = "acct_demo_" + shortHex();
            connectionDao.upsertAccount(
                    merchant.id(), accountId, ConnectStatus.CHARGES_ENABLED.wire(), true);
        } else {
            connectionDao.updateStatus(
                    merchant.id(), ConnectStatus.CHARGES_ENABLED.wire(), true, Instant.now(clock));
        }
        onboardingService.markStripeConnected(merchant.id());
        log.info("Demo Stripe Standard connect completed for merchant {} (account {})",
                merchant.id(), accountId);
        StripeConnection updated = connectionDao.findByMerchant(merchant.id()).orElse(null);
        return Response.ok(statusView(updated, false)).build();
    }

    /**
     * Persists a fresh account snapshot and, on the transition into
     * charges-enabled, advances the onboarding checklist. Returns the reloaded
     * connection. Shared by the status poll and (via the same status vocabulary)
     * the webhook handler in {@link StripeConnectResource}.
     */
    private StripeConnection syncFromAccount(Merchant merchant, StripeConnection conn, Account account) {
        ConnectStatus newStatus = StripeConnectStandardService.statusOf(account);
        boolean chargesEnabled = StripeConnectStandardService.chargesEnabled(account);
        boolean was = conn.isChargesEnabled();
        connectionDao.updateStatus(
                merchant.id(), newStatus.wire(), chargesEnabled, Instant.now(clock));
        if (!was && chargesEnabled) {
            onboardingService.markStripeConnected(merchant.id());
            log.info("Merchant {} Stripe Standard charges enabled (account {})",
                    merchant.id(), account.getId());
        }
        return connectionDao.findByMerchant(merchant.id()).orElse(conn);
    }

    private static Map<String, Object> statusView(StripeConnection conn, boolean configured) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("configured", configured);
        out.put("connected", conn != null && conn.isChargesEnabled());
        out.put("status", conn == null ? ConnectStatus.NOT_STARTED.wire() : conn.connectStatus());
        out.put("accountId", conn == null ? null : conn.stripeAccountId());
        out.put("chargesEnabled", conn != null && conn.isChargesEnabled());
        return out;
    }

    private static String shortHex() {
        long n = RNG.nextLong();
        return String.format("%012x", n & 0xFFFFFFFFFFFFL);
    }

    /**
     * Where Stripe drops the merchant after the hosted flow. Only the two
     * surfaces that own a Stripe section are accepted: /dashboard (the
     * "Account settings" tab) and the onboarding wizard's Connect step, so a
     * merchant who starts inside the wizard returns to it and can continue to
     * plan rules. Anything else, including a missing or absent body, falls back
     * to /dashboard. The allowlist is what keeps this from becoming an open
     * redirect: the value is never used as a full URL, only as a path appended
     * to the configured merchant base.
     */
    private static String returnPathOf(StartRequest req) {
        String path = req == null ? null : req.returnPath();
        return path != null && ALLOWED_RETURN_PATHS.contains(path) ? path : "/dashboard";
    }

    public record StartRequest(@JsonProperty("returnPath") String returnPath) {}

    private static Response notConfigured() {
        return Response.status(503)
                .entity(Map.of(
                        "error", "stripe_not_configured",
                        "message", "Stripe is not configured. Set STRIPE_SECRET_KEY on the backend."))
                .build();
    }
}
