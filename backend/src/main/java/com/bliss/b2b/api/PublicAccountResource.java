package com.bliss.b2b.api;

import com.bliss.b2b.auth.SessionCookies;
import com.bliss.b2b.persistence.PaymentPlanDao;
import com.bliss.b2b.persistence.PaymentPlanDao.PaymentPlanListItem;
import com.bliss.b2b.persistence.PaymentPlanDao.PlanScheduleSummary;
import com.bliss.b2b.service.CustomerAuthService;
import com.bliss.b2b.service.CustomerAuthService.LoginResult;
import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.CookieParam;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.HttpHeaders;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.time.Duration;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Customer-facing account endpoints, accessed without a tokenized URL.
 * Session is a JWT in the {@code bliss_customer_session} cookie issued
 * by {@link CustomerAuthService#attemptLogin}. Demo-mode auth — see
 * the comment block on that method.
 */
@Path("/api/v1/public/account")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class PublicAccountResource {

    public static final String COOKIE_NAME = "bliss_customer_session";
    private static final int COOKIE_MAX_AGE_SECONDS =
            (int) Duration.ofDays(30).toSeconds();

    private static final Logger log = LoggerFactory.getLogger(PublicAccountResource.class);

    private final CustomerAuthService authService;
    private final PaymentPlanDao planDao;

    public PublicAccountResource(CustomerAuthService authService, PaymentPlanDao planDao) {
        this.authService = authService;
        this.planDao = planDao;
    }

    @POST
    @Path("/login")
    public Response login(LoginRequest req) {
        if (req == null) {
            return Response.status(400).entity(Map.of("error", "body required")).build();
        }
        LoginResult result = authService.attemptLogin(req.email(), req.password());
        if (result instanceof LoginResult.NotFound) {
            return Response.status(404).entity(Map.of(
                    "error", "no_account_found",
                    "message", "We could not find an account for that email.")).build();
        }
        LoginResult.Ok ok = (LoginResult.Ok) result;
        // secure=false for dev. Production should pass true behind TLS; threading
        // an isProduction flag through here is left for the prod-auth rewrite.
        String setCookie = SessionCookies.buildSetCookie(
                COOKIE_NAME, ok.token(), COOKIE_MAX_AGE_SECONDS, false);
        return Response.ok(Map.of("status", "ok", "email", ok.email()))
                .header(HttpHeaders.SET_COOKIE, setCookie)
                .build();
    }

    @POST
    @Path("/logout")
    public Response logout() {
        String clearCookie = SessionCookies.buildClearCookie(COOKIE_NAME, false);
        return Response.ok(Map.of("status", "ok"))
                .header(HttpHeaders.SET_COOKIE, clearCookie)
                .build();
    }

    @GET
    @Path("/plans")
    public Response plans(@CookieParam(COOKIE_NAME) String sessionToken) {
        Optional<String> email = authService.verifySession(sessionToken);
        if (email.isEmpty()) {
            return Response.status(401).entity(Map.of(
                    "error", "unauthenticated",
                    "message", "Sign in to see your plans.")).build();
        }
        try {
            List<PaymentPlanListItem> items = planDao.findAllForCustomerEmail(email.get());
            Map<UUID, PlanScheduleSummary> summaryByPlan = new HashMap<>();
            if (!items.isEmpty()) {
                List<UUID> planIds = items.stream().map(PaymentPlanListItem::id).toList();
                planDao.summarizeSchedules(planIds)
                        .forEach(s -> summaryByPlan.put(s.paymentPlanId(), s));
            }
            return Response.ok(PublicAccountPlansView.from(email.get(), items, summaryByPlan))
                    .build();
        } catch (RuntimeException e) {
            log.error("Failed to load account plans for {}", email.get(), e);
            return Response.status(500).entity(Map.of("error", "internal_error")).build();
        }
    }

    public record LoginRequest(
            @JsonProperty("email") String email,
            @JsonProperty("password") String password
    ) {}
}
