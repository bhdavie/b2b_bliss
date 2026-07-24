package com.bliss.b2b.api;

import com.bliss.b2b.BlissConfiguration.AppConfig;
import com.bliss.b2b.auth.MerchantPrincipal;
import com.bliss.b2b.integration.cloudbeds.CloudbedsOAuthClient;
import com.bliss.b2b.integration.cloudbeds.CloudbedsOAuthClient.CloudbedsOAuthException;
import com.bliss.b2b.integration.cloudbeds.CloudbedsTokens;
import com.bliss.b2b.integration.pms.CloudbedsAdapterFactory;
import com.bliss.b2b.integration.pms.PmsAdapterException;
import com.bliss.b2b.integration.pms.PmsPropertyConfiguration;
import com.bliss.b2b.persistence.MerchantCloudbedsConnectionDao;
import com.bliss.b2b.service.PropertyOnboardingService;
import io.dropwizard.auth.Auth;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.net.URI;
import java.time.Clock;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Cloudbeds OAuth 2.0 plumbing.
 *
 * <ul>
 *   <li>{@code GET /cloudbeds/oauth/start} (merchant-authenticated): 302s the
 *       merchant to the Cloudbeds authorize URL, binding the callback to this
 *       merchant via {@code state}.
 *   <li>{@code GET /cloudbeds/oauth/callback} (unauthenticated; Cloudbeds
 *       redirects the browser here): exchanges the code for tokens, identifies
 *       the property, stores the connection, marks onboarding {@code pms_connected},
 *       and redirects to the dashboard settings page.
 * </ul>
 *
 * <p>Skeleton note: {@code state} carries the merchant id plus a nonce. Production
 * must HMAC-sign {@code state} (or store a server-side nonce) and verify it here
 * to prevent CSRF / merchant-binding forgery. Flagged, not built.
 */
@Path("/api/v1/cloudbeds/oauth")
@Produces(MediaType.APPLICATION_JSON)
public class CloudbedsOAuthResource {

    private static final Logger log = LoggerFactory.getLogger(CloudbedsOAuthResource.class);
    private static final java.security.SecureRandom RNG = new java.security.SecureRandom();

    private final CloudbedsOAuthClient oauthClient;
    private final CloudbedsAdapterFactory adapterFactory;
    private final MerchantCloudbedsConnectionDao connectionDao;
    private final PropertyOnboardingService onboardingService;
    private final AppConfig appConfig;
    private final Clock clock;

    public CloudbedsOAuthResource(
            CloudbedsOAuthClient oauthClient,
            CloudbedsAdapterFactory adapterFactory,
            MerchantCloudbedsConnectionDao connectionDao,
            PropertyOnboardingService onboardingService,
            AppConfig appConfig,
            Clock clock) {
        this.oauthClient = oauthClient;
        this.adapterFactory = adapterFactory;
        this.connectionDao = connectionDao;
        this.onboardingService = onboardingService;
        this.appConfig = appConfig;
        this.clock = clock;
    }

    @GET
    @Path("/start")
    public Response start(@Auth MerchantPrincipal principal) {
        if (!oauthClient.isConfigured()) {
            return notConfigured();
        }
        // state binds the callback to this merchant. See class note re: signing.
        String state = principal.merchant().id() + ":" + shortHex();
        String authorizeUrl = oauthClient.buildAuthorizeUrl(state);
        return Response.status(Response.Status.FOUND).location(URI.create(authorizeUrl)).build();
    }

    @GET
    @Path("/callback")
    public Response callback(
            @QueryParam("code") String code,
            @QueryParam("state") String state,
            @QueryParam("error") String error) {
        String settings = appConfig.getMerchantBaseUrl() + "/settings";
        if (error != null && !error.isBlank()) {
            log.info("Cloudbeds OAuth callback returned error: {}", error);
            return redirect(settings + "?cloudbeds=error");
        }
        if (!oauthClient.isConfigured()) {
            return redirect(settings + "?cloudbeds=not_configured");
        }
        UUID merchantId = merchantIdFromState(state);
        if (merchantId == null || code == null || code.isBlank()) {
            return redirect(settings + "?cloudbeds=error");
        }
        try {
            CloudbedsTokens tokens = oauthClient.exchangeCode(code);
            PmsPropertyConfiguration property = adapterFactory.identifyProperty(tokens.accessToken());
            Instant expiresAt = Instant.now(clock).plusSeconds(tokens.expiresInSeconds());
            connectionDao.upsert(
                    merchantId,
                    property.enterpriseId(),
                    property.name(),
                    property.defaultCurrency(),
                    tokens.accessToken(),
                    tokens.refreshToken(),
                    expiresAt,
                    Instant.now(clock));
            onboardingService.markCloudbedsConnected(merchantId);
            log.info("Cloudbeds connected for merchant {} (property {})",
                    merchantId, property.enterpriseId());
            return redirect(settings + "?cloudbeds=connected");
        } catch (CloudbedsOAuthException | PmsAdapterException e) {
            log.warn("Cloudbeds OAuth callback failed for merchant {}: {}", merchantId, e.getMessage());
            return redirect(settings + "?cloudbeds=error");
        }
    }

    /** state is "<merchantId>:<nonce>"; extract the merchant id. */
    private static UUID merchantIdFromState(String state) {
        if (state == null || state.isBlank()) {
            return null;
        }
        String idPart = state.contains(":") ? state.substring(0, state.indexOf(':')) : state;
        try {
            return UUID.fromString(idPart);
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    private static Response redirect(String url) {
        return Response.status(Response.Status.FOUND).location(URI.create(url)).build();
    }

    private static String shortHex() {
        long n = RNG.nextLong();
        return String.format("%016x", n);
    }

    private static Response notConfigured() {
        return Response.status(503)
                .entity(Map.of(
                        "error", "cloudbeds_not_configured",
                        "message", "Cloudbeds OAuth is not configured. Set CLOUDBEDS_CLIENT_ID and "
                                + "CLOUDBEDS_CLIENT_SECRET on the backend."))
                .build();
    }
}
