package com.bliss.b2b.api;

import com.bliss.b2b.auth.JwtService;
import com.bliss.b2b.auth.MerchantPrincipal;
import com.bliss.b2b.auth.SessionCookies;
import com.bliss.b2b.domain.Merchant;
import com.bliss.b2b.service.MagicLinkService;
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
import java.util.Map;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

@Path("/api/v1/auth")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class AuthResource {

    private static final Logger log = LoggerFactory.getLogger(AuthResource.class);

    private final MagicLinkService magicLinkService;
    private final JwtService jwtService;
    private final boolean secureCookies;
    private final boolean devLoginEnabled;
    private final int cookieMaxAgeSeconds;

    public AuthResource(
            MagicLinkService magicLinkService,
            JwtService jwtService,
            boolean secureCookies,
            boolean devLoginEnabled,
            int jwtTtlMinutes
    ) {
        this.magicLinkService = magicLinkService;
        this.jwtService = jwtService;
        this.secureCookies = secureCookies;
        this.devLoginEnabled = devLoginEnabled;
        this.cookieMaxAgeSeconds = jwtTtlMinutes * 60;
    }

    @POST
    @Path("/magic-link")
    public Response requestMagicLink(MagicLinkRequest req) {
        if (req == null || req.email() == null || req.email().isBlank()) {
            return Response.status(400).entity(Map.of("error", "email required")).build();
        }
        magicLinkService.requestLink(req.email());
        return Response.noContent().build();
    }

    @POST
    @Path("/verify")
    public Response verify(VerifyRequest req) {
        if (req == null || req.token() == null || req.token().isBlank()) {
            return Response.status(400).entity(Map.of("error", "token required")).build();
        }
        Optional<Merchant> merchant = magicLinkService.verify(req.token());
        if (merchant.isEmpty()) {
            return Response.status(400)
                    .entity(Map.of("error", "Invalid or expired link"))
                    .build();
        }
        Merchant m = merchant.get();
        String jwt = jwtService.issue(m.email(), m.id().toString());
        return Response.ok(MerchantView.from(m))
                .header(HttpHeaders.SET_COOKIE,
                        SessionCookies.buildSetCookie(jwt, cookieMaxAgeSeconds, secureCookies))
                .build();
    }

    /**
     * Dev-only login bypass. Skips the magic-link round trip entirely: a
     * merchant is found-or-created for the email, marked verified, and a
     * session cookie is set. Returns 404 in production so the route does
     * not exist there.
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
        Merchant merchant = magicLinkService.devLogin(req.email());
        log.info("Dev-login bypass issued session for merchant {} ({})",
                merchant.id(), merchant.email());
        String jwt = jwtService.issue(merchant.email(), merchant.id().toString());
        return Response.ok(MerchantView.from(merchant))
                .header(HttpHeaders.SET_COOKIE,
                        SessionCookies.buildSetCookie(jwt, cookieMaxAgeSeconds, secureCookies))
                .build();
    }

    /**
     * Public probe used by the /login UI to decide whether to show the
     * dev-mode shortcut. {@code enabled: true} means {@code POST /dev-login}
     * will accept any email; {@code false} means stick to the magic-link
     * flow.
     */
    @GET
    @Path("/dev-status")
    public Response devStatus() {
        return Response.ok(Map.of("devLoginEnabled", devLoginEnabled)).build();
    }

    @POST
    @Path("/sign-out")
    public Response signOut(@Auth Optional<MerchantPrincipal> _principal) {
        return Response.noContent()
                .header(HttpHeaders.SET_COOKIE, SessionCookies.buildClearCookie(secureCookies))
                .build();
    }

    public record MagicLinkRequest(@JsonProperty("email") String email) {}
    public record VerifyRequest(@JsonProperty("token") String token) {}
    public record DevLoginRequest(@JsonProperty("email") String email) {}
}
