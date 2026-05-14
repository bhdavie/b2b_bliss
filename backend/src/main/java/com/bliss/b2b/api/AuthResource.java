package com.bliss.b2b.api;

import com.bliss.b2b.auth.JwtService;
import com.bliss.b2b.auth.MerchantPrincipal;
import com.bliss.b2b.auth.SessionCookies;
import com.bliss.b2b.domain.Merchant;
import com.bliss.b2b.service.MagicLinkService;
import com.fasterxml.jackson.annotation.JsonProperty;
import io.dropwizard.auth.Auth;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.HttpHeaders;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.util.Map;
import java.util.Optional;

@Path("/api/v1/auth")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class AuthResource {

    private final MagicLinkService magicLinkService;
    private final JwtService jwtService;
    private final boolean secureCookies;
    private final int cookieMaxAgeSeconds;

    public AuthResource(
            MagicLinkService magicLinkService,
            JwtService jwtService,
            boolean secureCookies,
            int jwtTtlMinutes
    ) {
        this.magicLinkService = magicLinkService;
        this.jwtService = jwtService;
        this.secureCookies = secureCookies;
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

    @POST
    @Path("/sign-out")
    public Response signOut(@Auth Optional<MerchantPrincipal> _principal) {
        return Response.noContent()
                .header(HttpHeaders.SET_COOKIE, SessionCookies.buildClearCookie(secureCookies))
                .build();
    }

    public record MagicLinkRequest(@JsonProperty("email") String email) {}
    public record VerifyRequest(@JsonProperty("token") String token) {}
}
