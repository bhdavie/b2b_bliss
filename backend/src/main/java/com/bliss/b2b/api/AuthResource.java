package com.bliss.b2b.api;

import com.bliss.b2b.auth.CookieOptions;
import com.bliss.b2b.auth.JwtService;
import com.bliss.b2b.auth.MasterPassword;
import com.bliss.b2b.auth.MerchantPrincipal;
import com.bliss.b2b.auth.SessionCookies;
import com.bliss.b2b.domain.Merchant;
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
    private final MasterPassword masterPassword;
    /** Lowercased. Emails dev-login accepts even when devLoginEnabled is false. */
    private final Set<String> demoLoginEmails;

    public AuthResource(
            MagicLinkService magicLinkService,
            JwtService jwtService,
            CookieOptions cookieOptions,
            boolean devLoginEnabled,
            int jwtTtlMinutes,
            MerchantDao merchantDao,
            MasterPassword masterPassword,
            Set<String> demoLoginEmails
    ) {
        this.magicLinkService = magicLinkService;
        this.jwtService = jwtService;
        this.cookieOptions = cookieOptions;
        this.devLoginEnabled = devLoginEnabled;
        this.cookieMaxAgeSeconds = jwtTtlMinutes * 60;
        this.merchantDao = merchantDao;
        this.masterPassword = masterPassword;
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
     * <p>Open outside production, and in production when BLISS_DEMO_LOGIN is
     * set. It is additionally open — gate or no gate — for the specific
     * addresses in BLISS_DEMO_LOGIN_EMAILS, which is how the public demo
     * funnels keep signing anyone in as one curated demo property once the gate
     * is shut. Everything else 404s, so the route does not exist for it.
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
     * {@code devLoginEnabled: true} means {@code POST /dev-login} will accept
     * any email; {@code false} means magic link is the only way in. True
     * outside production, and in production when BLISS_DEMO_LOGIN is set.
     *
     * <p>This is what lets BLISS_DEMO_LOGIN be flipped without a frontend
     * change, so keep it in step with the gate on {@link #devLogin}.
     */
    @GET
    @Path("/dev-status")
    public Response devStatus() {
        // masterPasswordEnabled is TEMPORARY — remove with the bypass. It tells
        // the sign-in pages (merchant and admin, which both read this one probe)
        // whether to render the password field at all. It has to be reported
        // separately from devLoginEnabled because the bypass is deliberately
        // independent of the demo gate: the case it exists for is demo OFF,
        // where the field would otherwise never appear.
        //
        // This does advertise that a master password is configured. That is a
        // real disclosure, but strictly smaller than the one already on this
        // endpoint — devLoginEnabled announces that any email signs in with no
        // password at all — and it disappears when MASTER_PASSWORD is unset.
        return Response.ok(Map.of(
                "devLoginEnabled", devLoginEnabled,
                "masterPasswordEnabled", masterPassword.isEnabled())).build();
    }

    /**
     * TEMPORARY MASTER PASSWORD BYPASS — REMOVE BEFORE REAL MERCHANT OR GUEST
     * ONBOARDING.
     *
     * <p>When {@code MASTER_PASSWORD} is set, submitting it here signs in as any
     * EXISTING merchant, whatever that merchant's own credentials are. Unlike
     * {@link #devLogin} this never creates a merchant: an unknown email is 401,
     * so the bypass can only reach accounts that already exist.
     *
     * <p>Deliberately independent of the demoLogin gate — the bypass exists for
     * the case where magic link is the only other way in — but it stays shut
     * whenever MASTER_PASSWORD is unset, which answers 404 so the route does not
     * appear to exist. Nothing here reads or writes a stored credential, and no
     * other sign-in path changes behaviour.
     *
     * <p>Removal: delete this method, the two fields above, the two constructor
     * parameters, and see {@link com.bliss.b2b.auth.MasterPassword} for the rest.
     */
    @POST
    @Path("/password-login")
    public Response passwordLogin(PasswordLoginRequest req) {
        if (!masterPassword.isEnabled()) {
            return Response.status(404).entity(Map.of("error", "not_found")).build();
        }
        if (req == null || req.email() == null || req.email().isBlank()
                || req.password() == null || req.password().isEmpty()) {
            return Response.status(400)
                    .entity(Map.of("error", "email and password required")).build();
        }
        if (!masterPassword.matches(req.password())) {
            return Response.status(401).entity(Map.of("error", "invalid_credentials")).build();
        }
        Optional<Merchant> merchant = merchantDao.findByEmail(req.email().trim().toLowerCase());
        if (merchant.isEmpty()) {
            // Same 401 as a wrong password: the bypass should not double as an
            // oracle for which addresses have accounts.
            return Response.status(401).entity(Map.of("error", "invalid_credentials")).build();
        }
        Merchant m = merchant.get();
        log.warn("MASTER_PASSWORD bypass issued merchant session for {} ({}) — temporary, "
                + "remove before real onboarding", m.id(), m.email());
        String jwt = jwtService.issue(m.email(), m.id().toString());
        return Response.ok(MerchantView.from(m))
                .header(HttpHeaders.SET_COOKIE,
                        SessionCookies.buildSetCookie(jwt, cookieMaxAgeSeconds, cookieOptions))
                .build();
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
    public record PasswordLoginRequest(
            @JsonProperty("email") String email,
            @JsonProperty("password") String password) {}
}
