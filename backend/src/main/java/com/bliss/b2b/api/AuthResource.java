package com.bliss.b2b.api;

import com.bliss.b2b.auth.CookieOptions;
import com.bliss.b2b.auth.JwtService;
import com.bliss.b2b.auth.MerchantPrincipal;
import com.bliss.b2b.auth.SessionCookies;
import com.bliss.b2b.domain.Merchant;
import com.bliss.b2b.persistence.AdminUserDao;
import com.bliss.b2b.persistence.MerchantDao;
import com.bliss.b2b.service.MagicLinkDeliveryException;
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
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

@Path("/api/v1/auth")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class AuthResource {

    private static final Logger log = LoggerFactory.getLogger(AuthResource.class);

    private final MagicLinkService magicLinkService;
    private final JwtService jwtService;
    private final CookieOptions cookieOptions;
    private final boolean devLoginEnabled;
    private final int cookieMaxAgeSeconds;
    // TEMPORARY MASTER PASSWORD BYPASS — remove with passwordLogin() below.
    private final MerchantDao merchantDao;
    /**
     * Only so dev-login can refuse an address that is an admin. An admin must
     * never be reachable through a merchant bypass: dev-login PROVISIONS a
     * verified merchant for an unknown address, so without this an admin's
     * address on the allowlist would silently gain a second, merchant-side
     * identity with a session attached.
     */
    private final AdminUserDao adminUserDao;
    /** Lowercased. Emails dev-login accepts even when devLoginEnabled is false. */
    private final Set<String> demoLoginEmails;

    public AuthResource(
            MagicLinkService magicLinkService,
            JwtService jwtService,
            CookieOptions cookieOptions,
            boolean devLoginEnabled,
            int jwtTtlMinutes,
            MerchantDao merchantDao,
            AdminUserDao adminUserDao,
            Set<String> demoLoginEmails
    ) {
        this.magicLinkService = magicLinkService;
        this.jwtService = jwtService;
        this.cookieOptions = cookieOptions;
        this.devLoginEnabled = devLoginEnabled;
        this.cookieMaxAgeSeconds = jwtTtlMinutes * 60;
        this.merchantDao = merchantDao;
        this.adminUserDao = adminUserDao;
        this.demoLoginEmails = demoLoginEmails;
    }

    @POST
    @Path("/magic-link")
    public Response requestMagicLink(MagicLinkRequest req) {
        if (req == null || req.email() == null || req.email().isBlank()) {
            return Response.status(400).entity(Map.of("error", "email required")).build();
        }
        try {
            magicLinkService.requestLink(req.email());
        } catch (MagicLinkDeliveryException e) {
            // The link is the only way in, so a delivery failure has to be
            // visible. Silently 204-ing would leave the merchant watching an
            // inbox that will never receive anything.
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
                        SessionCookies.buildSetCookie(jwt, cookieMaxAgeSeconds, cookieOptions))
                .build();
    }

    /**
     * Demo login bypass. Skips the magic-link round trip entirely: a merchant
     * is found-or-created for the email, marked verified, and a session cookie
     * is set. No password is involved.
     *
     * <p>Open outside production. IN PRODUCTION IT IS ALLOWLIST ONLY: the gate
     * is closed and the only way through is an address in BLISS_DEMO_LOGIN_EMAILS,
     * which is how the public demo funnels keep signing anyone in as one curated
     * demo property. Everything else 404s, so the route does not exist for it.
     *
     * <p>BLISS_DEMO_LOGIN no longer opens this in production, and that is the
     * point of the change. It used to, and with it on this endpoint would
     * provision a verified merchant for ANY address submitted to it, with a
     * session attached and no secret required. That was a larger hole than the
     * master password it sat beside, which at least needed a shared secret and
     * could only reach accounts that already existed.
     *
     * <p>The email is read and normalised BEFORE the gate is applied, because
     * the allowlist check needs it. An address that is neither allowlisted nor
     * covered by the gate gets the same 404 as before, so nothing about the
     * closed case is observable from outside.
     */
    @POST
    @Path("/dev-login")
    public Response devLogin(DevLoginRequest req) {
        if (req == null || req.email() == null || req.email().isBlank()) {
            // 400 ahead of the gate: a request with no email is malformed
            // whatever the gate says, and this leaks nothing about the gate
            // because it cannot be reached with a real address.
            return Response.status(400).entity(Map.of("error", "email required")).build();
        }
        String normalized = req.email().trim().toLowerCase();
        if (!devLoginEnabled && !demoLoginEmails.contains(normalized)) {
            return Response.status(404).entity(Map.of("error", "not_found")).build();
        }
        // ADMINS ARE NEVER REACHABLE HERE, allowlisted or not, gate open or not.
        // This is not belt and braces: devLogin below PROVISIONS a verified
        // merchant for an address it does not know, so an admin address arriving
        // here would be given a second identity on the merchant side with a live
        // session on it. Checked before that call, so the refusal cannot create
        // the row it is refusing.
        //
        // 404, the same answer the closed gate gives, so this does not become a
        // way to ask whether an address is an admin.
        if (adminUserDao.findByEmail(normalized).isPresent()) {
            log.warn("Dev-login refused for {}: address is an admin", normalized);
            return Response.status(404).entity(Map.of("error", "not_found")).build();
        }
        Merchant merchant = magicLinkService.devLogin(normalized);
        log.info("Dev-login bypass issued session for merchant {} ({})",
                merchant.id(), merchant.email());
        String jwt = jwtService.issue(merchant.email(), merchant.id().toString());
        return Response.ok(MerchantView.from(merchant))
                .header(HttpHeaders.SET_COOKIE,
                        SessionCookies.buildSetCookie(jwt, cookieMaxAgeSeconds, cookieOptions))
                .build();
    }

    /**
     * Public probe the sign-in page reads to decide which path to render.
     * {@code devLoginEnabled: true} means {@code POST /dev-login} will accept any
     * email with no password. It is true outside production and false in
     * production, full stop: see the gate on {@link #devLogin}.
     *
     * <p>It no longer reports masterPasswordEnabled. That bypass is gone, and
     * with it the password field on both sign-in pages.
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
                .header(HttpHeaders.SET_COOKIE, SessionCookies.buildClearCookie(cookieOptions))
                .build();
    }

    public record MagicLinkRequest(@JsonProperty("email") String email) {}
    public record VerifyRequest(@JsonProperty("token") String token) {}
    public record DevLoginRequest(@JsonProperty("email") String email) {}
    // TEMPORARY MASTER PASSWORD BYPASS — remove with passwordLogin().
}
