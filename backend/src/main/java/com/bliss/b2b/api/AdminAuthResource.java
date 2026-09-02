package com.bliss.b2b.api;

import com.bliss.b2b.auth.AdminPrincipal;
import com.bliss.b2b.auth.CookieOptions;
import com.bliss.b2b.auth.JwtService;
import com.bliss.b2b.auth.SessionCookies;
import com.bliss.b2b.domain.AdminUser;
import com.bliss.b2b.service.AdminAuthService;
import com.bliss.b2b.service.MagicLinkDeliveryException;
import com.fasterxml.jackson.annotation.JsonProperty;
import io.dropwizard.auth.Auth;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.HttpHeaders;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Sign-in for the Bliss internal admin. Mirrors {@link AuthResource}, including
 * the dev-login gate, with one difference that runs through every entry point:
 * there is no admin signup and no find-or-create, so an email that does not
 * already match an {@code admin_users} row is rejected rather than provisioned.
 */
@Path("/api/v1/admin/auth")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class AdminAuthResource {

    private static final Logger log = LoggerFactory.getLogger(AdminAuthResource.class);

    private final AdminAuthService adminAuthService;
    private final JwtService jwtService;
    private final CookieOptions cookieOptions;
    private final boolean devLoginEnabled;
    private final int cookieMaxAgeSeconds;

    public AdminAuthResource(
            AdminAuthService adminAuthService,
            JwtService jwtService,
            CookieOptions cookieOptions,
            boolean devLoginEnabled,
            int jwtTtlMinutes
    ) {
        this.adminAuthService = adminAuthService;
        this.jwtService = jwtService;
        this.cookieOptions = cookieOptions;
        this.devLoginEnabled = devLoginEnabled;
        this.cookieMaxAgeSeconds = jwtTtlMinutes * 60;
    }

    /**
     * Answers 204 whether or not the address is an admin. The merchant flow can
     * afford to be transparent because anyone may sign up; here the set of valid
     * addresses is a short internal list, so a distinguishable response would
     * enumerate it. A delivery failure is still surfaced, since the link is the
     * only way in and silence would leave someone watching a dead inbox.
     */
    @POST
    @Path("/magic-link")
    public Response requestMagicLink(MagicLinkRequest req) {
        if (req == null || req.email() == null || req.email().isBlank()) {
            return Response.status(400).entity(Map.of("error", "email required")).build();
        }
        try {
            adminAuthService.requestLink(req.email());
        } catch (MagicLinkDeliveryException e) {
            return Response.status(502).entity(Map.of(
                    "error", "email_delivery_failed",
                    "message", "We could not send the sign-in email just now. Try again in a moment."))
                    .build();
        }
        return Response.noContent().build();
    }

    @POST
    @Path("/verify")
    public Response verify(VerifyRequest req) {
        if (req == null || req.token() == null || req.token().isBlank()) {
            return Response.status(400).entity(Map.of("error", "token required")).build();
        }
        Optional<AdminUser> admin = adminAuthService.verify(req.token());
        if (admin.isEmpty()) {
            return Response.status(400)
                    .entity(Map.of("error", "Invalid or expired link"))
                    .build();
        }
        return sessionResponse(admin.get());
    }

    /**
     * Demo login bypass, on the same gate as the merchant one: outside
     * production, and in production only when BLISS_DEMO_LOGIN is set.
     * Otherwise 404, so the route does not exist.
     *
     * <p>Unlike the merchant bypass this does not accept any email. It still
     * requires an existing admin_users row, so the worst BLISS_DEMO_LOGIN can
     * do here is skip the email round trip for someone already provisioned.
     */
    @POST
    @Path("/dev-login")
    public Response devLogin(DevLoginRequest req) {
        if (!devLoginEnabled) {
            return Response.status(404).entity(Map.of("error", "not_found")).build();
        }
        if (req == null || req.email() == null || req.email().isBlank()) {
            return Response.status(400).entity(Map.of("error", "email required")).build();
        }
        Optional<AdminUser> admin = adminAuthService.devLogin(req.email());
        if (admin.isEmpty()) {
            return Response.status(401).entity(Map.of("error", "not_an_admin")).build();
        }
        log.info("Admin dev-login bypass issued session for admin {} ({})",
                admin.get().id(), admin.get().email());
        return sessionResponse(admin.get());
    }

    @POST
    @Path("/sign-out")
    public Response signOut(@Auth Optional<AdminPrincipal> _principal) {
        return Response.noContent()
                .header(HttpHeaders.SET_COOKIE,
                        SessionCookies.buildClearCookie(
                                SessionCookies.ADMIN_COOKIE_NAME, cookieOptions))
                .build();
    }

    @GET
    @Path("/me")
    public Response me(@Auth AdminPrincipal principal) {
        return Response.ok(view(principal.admin())).build();
    }

    private Response sessionResponse(AdminUser admin) {
        String jwt = jwtService.issueAdmin(admin.email(), admin.id().toString());
        return Response.ok(view(admin))
                .header(HttpHeaders.SET_COOKIE,
                        SessionCookies.buildSetCookie(
                                SessionCookies.ADMIN_COOKIE_NAME, jwt,
                                cookieMaxAgeSeconds, cookieOptions))
                .build();
    }

    /** LinkedHashMap rather than Map.of: name is nullable, and it keeps order. */
    private static Map<String, Object> view(AdminUser admin) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("id", admin.id().toString());
        out.put("email", admin.email());
        out.put("name", admin.name());
        return out;
    }

    public record MagicLinkRequest(@JsonProperty("email") String email) {}
    public record VerifyRequest(@JsonProperty("token") String token) {}
    public record DevLoginRequest(@JsonProperty("email") String email) {}
}
