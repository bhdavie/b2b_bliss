package com.bliss.b2b.api;

import com.bliss.b2b.auth.CookieOptions;
import com.bliss.b2b.auth.SessionCookies;
import com.bliss.b2b.domain.Customer;
import com.bliss.b2b.persistence.CustomerDao;
import com.bliss.b2b.persistence.PaymentPlanDao;
import com.bliss.b2b.persistence.PaymentPlanDao.PaymentPlanListItem;
import com.bliss.b2b.persistence.PaymentPlanDao.ScheduleRow;
import com.bliss.b2b.service.CustomerAuthService;
import com.bliss.b2b.service.MagicLinkDeliveryException;
import com.bliss.b2b.service.MagicLinkService;
import com.bliss.b2b.service.PlanProgress;
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
import java.time.Clock;
import java.time.LocalDate;
import java.util.ArrayList;
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

    private static final Logger log = LoggerFactory.getLogger(PublicAccountResource.class);

    private final CustomerAuthService authService;
    private final MagicLinkService magicLinkService;
    /**
     * Whether POST /dev-login is live. Same gate as the merchant side's
     * dev-login: on outside production, and in production only when
     * BLISS_DEMO_LOGIN is set. Computed once in BlissApplication and passed to
     * both resources so the two sign-in surfaces cannot end up on different
     * rules.
     */
    private final boolean devLoginEnabled;
    private final PaymentPlanDao planDao;
    private final CustomerDao customerDao;
    private final Clock clock;
    private final CookieOptions cookieOptions;
    private final int cookieMaxAgeSeconds;

    public PublicAccountResource(
            CustomerAuthService authService,
            MagicLinkService magicLinkService,
            boolean devLoginEnabled,
            PaymentPlanDao planDao,
            CustomerDao customerDao,
            Clock clock,
            CookieOptions cookieOptions,
            int jwtTtlMinutes) {
        this.authService = authService;
        this.magicLinkService = magicLinkService;
        this.devLoginEnabled = devLoginEnabled;
        this.planDao = planDao;
        this.customerDao = customerDao;
        this.clock = clock;
        this.cookieOptions = cookieOptions;
        // Derived from the JWT TTL rather than fixed, matching AuthResource. The
        // cookie used to live 30 days while the token inside it lived one hour,
        // so for the other 29 days the browser held a session that could not
        // verify: /account bounced to the login screen, which bounced back.
        // Tying the two together means the cookie disappears exactly when the
        // token it carries stops being worth anything.
        this.cookieMaxAgeSeconds = jwtTtlMinutes * 60;
    }

    /**
     * Requests a guest magic link. Account-must-exist is preserved: an unknown
     * email gets the same 404 and the same message the password flow returned,
     * because a guest account is created by a property sending a plan link, not
     * by typing an address into the sign-in box.
     *
     * <p>This does mean the response distinguishes a known address from an
     * unknown one, which is an enumeration surface. It is kept because the
     * sign-in screen's copy promises exactly that explanation, and silently
     * accepting an unknown address would leave the guest watching an inbox
     * nothing is coming to. Worth revisiting alongside real rate limiting.
     */
    @POST
    @Path("/magic-link")
    public Response requestMagicLink(MagicLinkRequest req) {
        if (req == null || req.email() == null || req.email().isBlank()) {
            return Response.status(400).entity(Map.of("error", "email required")).build();
        }
        Optional<Customer> customer;
        try {
            customer = magicLinkService.requestCustomerLink(req.email());
        } catch (MagicLinkDeliveryException e) {
            // The link is the only way in, so a delivery failure has to be
            // visible rather than a silent 204.
            return Response.status(502).entity(Map.of(
                    "error", "email_delivery_failed",
                    "message", "We could not send the sign-in email just now. Try again in a moment."))
                    .build();
        }
        if (customer.isEmpty()) {
            return Response.status(404).entity(Map.of(
                    "error", "no_account_found",
                    "message", "We could not find an account for that email.")).build();
        }
        return Response.noContent().build();
    }

    /** Consumes a guest magic-link token and issues the session cookie. */
    @POST
    @Path("/verify")
    public Response verify(VerifyRequest req) {
        if (req == null || req.token() == null || req.token().isBlank()) {
            return Response.status(400).entity(Map.of("error", "token required")).build();
        }
        Optional<Customer> customer = magicLinkService.verifyCustomer(req.token());
        if (customer.isEmpty()) {
            return Response.status(400).entity(Map.of(
                    "error", "invalid_token",
                    "message", "That sign-in link is no longer valid. Request a new one.")).build();
        }
        return sessionResponse(customer.get());
    }

    /**
     * Dev-only guest sign-in with no email round trip, mirroring the merchant
     * POST /api/v1/auth/dev-login. 404 when the gate is off, so the route does
     * not exist rather than refusing.
     *
     * <p>Unlike the merchant equivalent this does NOT find-or-create. The
     * account-must-exist rule is a product rule and the shortcut does not get
     * to bend it.
     */
    @POST
    @Path("/dev-login")
    public Response devLogin(MagicLinkRequest req) {
        if (!devLoginEnabled) {
            return Response.status(404).entity(Map.of("error", "not_found")).build();
        }
        if (req == null || req.email() == null || req.email().isBlank()) {
            return Response.status(400).entity(Map.of("error", "email required")).build();
        }
        Optional<Customer> customer = magicLinkService.devCustomerLogin(req.email());
        if (customer.isEmpty()) {
            return Response.status(404).entity(Map.of(
                    "error", "no_account_found",
                    "message", "We could not find an account for that email.")).build();
        }
        log.info("Guest dev-login bypass issued session for customer {}", customer.get().id());
        return sessionResponse(customer.get());
    }

    /**
     * Public probe the guest sign-in page reads to decide which path to render,
     * mirroring GET /api/v1/auth/dev-status on the merchant side.
     */
    @GET
    @Path("/dev-status")
    public Response devStatus() {
        return Response.ok(Map.of("devLoginEnabled", devLoginEnabled)).build();
    }

    private Response sessionResponse(Customer customer) {
        String token = authService.issueSession(customer);
        String setCookie = SessionCookies.buildSetCookie(
                COOKIE_NAME, token, cookieMaxAgeSeconds, cookieOptions);
        return Response.ok(Map.of("status", "ok", "email", customer.email()))
                .header(HttpHeaders.SET_COOKIE, setCookie)
                .build();
    }

    @POST
    @Path("/logout")
    public Response logout() {
        String clearCookie = SessionCookies.buildClearCookie(COOKIE_NAME, cookieOptions);
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
            Map<UUID, PlanProgress.Snapshot> progressByPlan = new HashMap<>();
            if (!items.isEmpty()) {
                List<UUID> planIds = items.stream().map(PaymentPlanListItem::id).toList();
                Map<UUID, List<PlanProgress.Row>> rowsByPlan = new HashMap<>();
                for (ScheduleRow r : planDao.scheduleRowsForPlans(planIds)) {
                    rowsByPlan
                            .computeIfAbsent(r.paymentPlanId(), k -> new ArrayList<>())
                            .add(new PlanProgress.Row(
                                    r.dueDate(), r.amountCents(), r.status()));
                }
                LocalDate today = LocalDate.now(clock);
                for (PaymentPlanListItem item : items) {
                    long totalWithFee = item.totalAmountCents() + item.processingFeeCents();
                    progressByPlan.put(
                            item.id(),
                            PlanProgress.asOf(
                                    rowsByPlan.getOrDefault(item.id(), List.of()),
                                    totalWithFee,
                                    today,
                                    item.status()));
                }
            }
            Customer customer = customerDao.findByEmail(email.get()).orElse(null);
            String firstName = customer == null ? null : customer.firstName();
            String lastName = customer == null ? null : customer.lastName();
            return Response.ok(
                    PublicAccountPlansView.from(
                            email.get(), firstName, lastName, items, progressByPlan))
                    .build();
        } catch (RuntimeException e) {
            log.error("Failed to load account plans for {}", email.get(), e);
            return Response.status(500).entity(Map.of("error", "internal_error")).build();
        }
    }

    /** Body for both /magic-link and /dev-login. No password field any more. */
    public record MagicLinkRequest(@JsonProperty("email") String email) {}

    public record VerifyRequest(@JsonProperty("token") String token) {}
}
