package com.bliss.b2b.api;

import com.bliss.b2b.domain.Referral;
import com.bliss.b2b.domain.ReferralMessages;
import com.bliss.b2b.domain.Referrer;
import com.bliss.b2b.integration.EmailService;
import com.bliss.b2b.integration.EmailTemplates;
import com.bliss.b2b.service.ReferralService;
import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.Context;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.time.Clock;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Guest referral intake: a guest tells us about a hotel they want on Bliss.
 * Unauthenticated, and called from the marketing site (bliss-payments.com),
 * which reaches it through the global CORS allow-list rather than a
 * per-response override like the Mews plan-rules endpoint uses.
 *
 * <p>Order of checks is deliberate. The rate limit runs first, on every POST
 * whether or not the body is valid, so a script cannot probe validation for
 * free. Validation runs before any database work.
 *
 * <p>The response is always 201 with the referral id and nothing else. A
 * duplicate inside the 30-day window gets the existing id under the same 201,
 * so the status code cannot be used to learn whether an email already referred
 * a hotel. An unknown email is not a 404 here either: any address may refer.
 */
@Path("/api/v1/public/referrals")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class PublicReferralsResource {

    private static final Logger log = LoggerFactory.getLogger(PublicReferralsResource.class);

    static final int MAX_EMAIL = 254;
    static final int MAX_NAME = 200;
    static final int MAX_HOTEL_FIELD = 200;
    static final int MAX_NOTE = 1000;

    public static final int RATE_LIMIT_REQUESTS = 5;
    public static final Duration RATE_LIMIT_WINDOW = Duration.ofMinutes(10);

    /**
     * Plausible, not RFC 5322: something, an @, a dotted domain, no whitespace.
     * The goal is catching typos and junk, not deciding deliverability.
     */
    private static final Pattern EMAIL = Pattern.compile("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$");

    private final ReferralService service;
    private final IpRateLimiter rateLimiter;
    private final Clock clock;
    private final EmailService emailService;
    private final String marketingBaseUrl;

    public PublicReferralsResource(
            ReferralService service,
            IpRateLimiter rateLimiter,
            Clock clock,
            EmailService emailService,
            String marketingBaseUrl) {
        this.service = service;
        this.rateLimiter = rateLimiter;
        this.clock = clock;
        this.emailService = emailService;
        this.marketingBaseUrl = stripTrailingSlash(marketingBaseUrl);
    }

    // ------------------------------------------------------------------ kit

    /**
     * Gives a guest their referral link, creating them if this is the first
     * time we have seen the address.
     *
     * <p>Idempotent on email, by design and not by accident: a guest who asks
     * twice gets the same code, because a second code would split their credit
     * across two links. The response is the same either way, so this cannot be
     * used to find out whether an address is already signed up.
     *
     * <p>Rate limited on the IP AND the email, both against the same budget.
     * The IP key stops one client scripting the endpoint; the email key stops a
     * distributed script mailing one person repeatedly, which the IP key alone
     * would not catch.
     */
    @POST
    @Path("/start")
    public Response start(StartRequest req, @Context HttpServletRequest http) {
        String ip = callerIp(http);
        IpRateLimiter.Decision byIp = rateLimiter.tryAcquire("ip:" + ip);
        if (!byIp.allowed()) return rateLimited(byIp);

        if (req == null) return badRequest("body_required", "Enter your email address.");
        String email = trimToNull(req.email());
        if (email == null || email.length() > MAX_EMAIL || !EMAIL.matcher(email).matches()) {
            return badRequest("invalid_email", "Enter a valid email address.");
        }
        String hotelName = trimToNull(req.hotelName());
        String hotelCity = trimToNull(req.hotelCity());
        if (hotelName != null && hotelName.length() > MAX_HOTEL_FIELD) {
            return badRequest("invalid_hotel_name",
                    "The hotel's name must be " + MAX_HOTEL_FIELD + " characters or fewer.");
        }
        if (hotelCity != null && hotelCity.length() > MAX_HOTEL_FIELD) {
            return badRequest("invalid_hotel_city",
                    "The hotel's city must be " + MAX_HOTEL_FIELD + " characters or fewer.");
        }

        IpRateLimiter.Decision byEmail =
                rateLimiter.tryAcquire("email:" + email.toLowerCase(java.util.Locale.ROOT));
        if (!byEmail.allowed()) return rateLimited(byEmail);

        Referrer referrer = service.startReferrer(email, clock.instant());

        // A named hotel rides along as an ordinary referral, so the admin queue
        // sees it exactly as it sees a V28 submission.
        if (hotelName != null && hotelCity != null) {
            service.create(
                    new ReferralService.NewReferral(
                            referrer.email(), null, hotelName, hotelCity, null, ip,
                            referrer.id(), referrer.code()),
                    clock.instant());
        }

        // The 201 is now conditional on the mail going out, because the mail is
        // the whole delivery. See sendKitEmail.
        Response failure = sendKitEmail(referrer);
        if (failure != null) return failure;
        return Response.status(201).entity(kitBody(referrer)).build();
    }

    /**
     * The guest's status page, reached by the magic link in their email.
     *
     * <p>404 for an unknown token, with no distinction between "never existed"
     * and "no longer valid", because there is nothing else it could usefully
     * say and the difference would confirm a guess.
     */
    @GET
    @Path("/status/{token}")
    public Response status(@PathParam("token") String token) {
        Optional<Referrer> referrer = service.findReferrerByToken(token);
        if (referrer.isEmpty()) {
            return Response.status(404).entity(Map.of("error", "unknown_token")).build();
        }
        Referrer r = referrer.get();
        Map<String, Object> body = new LinkedHashMap<>(kitBody(r));
        body.put("referrals", service.listByReferrer(r.id()).stream()
                .map(PublicReferralsResource::publicReferral)
                .toList());
        return Response.ok(body).build();
    }

    // --------------------------------------------------------------- tracking

    /**
     * A hotel opened a guest's link. See ReferralService for first click wins.
     *
     * <p>Always 200, whether or not the code resolved. The marketing site calls
     * this on every page load carrying a ?ref, including ones carrying a typo
     * or a stale code, and a 404 there would be noise in its logs rather than
     * information. {@code attributed} says whether anything was recorded.
     */
    @POST
    @Path("/click")
    public Response click(CodeRequest req) {
        String code = req == null ? null : trimToNull(req.code());
        if (code == null) return Response.ok(Map.of("attributed", false)).build();
        return Response.ok(Map.of(
                "attributed", service.recordClick(code, clock.instant()).isPresent())).build();
    }

    /** The hotel opened the Calendly widget from a link. Same always-200 contract as click. */
    @POST
    @Path("/demo-booked")
    public Response demoBooked(CodeRequest req) {
        String code = req == null ? null : trimToNull(req.code());
        if (code == null) return Response.ok(Map.of("attributed", false)).build();
        return Response.ok(Map.of(
                "attributed", service.markDemoBooked(code, clock.instant()).isPresent())).build();
    }

    // ---------------------------------------------------------------- shared

    private String referralLink(Referrer r) {
        return marketingBaseUrl + "/hotels?ref=" + r.code();
    }

    private String statusUrl(Referrer r) {
        return marketingBaseUrl + "/referrals/" + r.magicToken();
    }

    /**
     * What the site renders for the kit. The messages come from the backend so
     * the email and the page cannot drift; the site holds no copy of its own.
     */
    private Map<String, Object> kitBody(Referrer r) {
        String link = referralLink(r);
        ReferralMessages.Kit kit = ReferralMessages.forLink(link);
        List<Map<String, Object>> messages = kit.all().stream()
                .map(m -> {
                    Map<String, Object> out = new LinkedHashMap<String, Object>();
                    out.put("id", m.id());
                    out.put("label", m.label());
                    out.put("subject", m.subject());
                    out.put("body", m.body());
                    return out;
                })
                .toList();
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("code", r.code());
        body.put("link", link);
        body.put("statusUrl", statusUrl(r));
        body.put("messages", messages);
        return body;
    }

    /** No guest email, no IP, no note. This shape is safe to hand a browser. */
    private static Map<String, Object> publicReferral(Referral r) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("id", r.id().toString());
        out.put("hotelName", r.hotelName());
        out.put("hotelCity", r.hotelCity());
        out.put("status", r.status().wire());
        out.put("clickedAt", r.clickedAt() == null ? null : r.clickedAt().toString());
        out.put("createdAt", r.createdAt().toString());
        return out;
    }

    /**
     * FAILS THE REQUEST NOW, which is a deliberate reversal.
     *
     * <p>It used to swallow the error and let /start return 201, on the reasoning
     * that the guest already had their link on screen so a provider outage cost
     * them only the copy in their inbox. That reasoning died with the on-page
     * kit: the email is the only place the link and the three messages are
     * delivered, so a swallowed failure now hands the guest a success screen and
     * nothing else. It also made a misconfiguration indistinguishable from a
     * working send at every layer above this one, which is exactly how a blank
     * Postmark token went unnoticed.
     *
     * <p>The referrer row stays. It is committed before this runs, the code is
     * already allocated, and startReferrer returns the existing row for a known
     * email, so a retry re-sends to the same referrer rather than making a
     * second one. Nothing here rolls back.
     *
     * @return null when the mail went, or the error Response to return as is.
     */
    private Response sendKitEmail(Referrer r) {
        try {
            emailService.send(EmailTemplates.referralLink(
                    r.email(), r.code(), referralLink(r), statusUrl(r), marketingBaseUrl));
            return null;
        } catch (RuntimeException e) {
            log.error("Referral kit email failed for referrer {}", r.id(), e);
            // 502, not 500: the failure is a downstream provider, and the row
            // this endpoint owns was written correctly. `error` is the key the
            // site checks; `message` is what it shows if it has nothing better.
            return Response.status(502)
                    .entity(Map.of(
                            "error", "email_not_sent",
                            "message", "Something went wrong sending your link. Try again, "
                                + "or email info@bliss-payments.com."))
                    .build();
        }
    }

    private static Response rateLimited(IpRateLimiter.Decision decision) {
        return Response.status(429)
                .header("Retry-After", decision.retryAfterSeconds())
                .entity(Map.of(
                        "error", "rate_limited",
                        "message", "You've sent a few of these already. Try again in a little while."))
                .build();
    }

    private static String stripTrailingSlash(String url) {
        if (url == null) return "";
        return url.endsWith("/") ? url.substring(0, url.length() - 1) : url;
    }

    public record StartRequest(
            @JsonProperty("email") String email,
            @JsonProperty("hotelName") String hotelName,
            @JsonProperty("hotelCity") String hotelCity) {}

    public record CodeRequest(@JsonProperty("code") String code) {}

    @POST
    public Response create(ReferralRequest req, @Context HttpServletRequest http) {
        String ip = callerIp(http);
        IpRateLimiter.Decision decision = rateLimiter.tryAcquire(ip);
        if (!decision.allowed()) {
            log.info("Referral rate limit hit for {}", ip);
            return Response.status(429)
                    .header("Retry-After", decision.retryAfterSeconds())
                    .entity(Map.of(
                            "error", "rate_limited",
                            "message", "You've sent a few of these already. Try again in a little while."))
                    .build();
        }

        if (req == null) {
            return badRequest("body_required", "Tell us about the hotel you'd love to see on Bliss.");
        }
        String email = trimToNull(req.guestEmail());
        String guestName = trimToNull(req.guestName());
        String hotelName = trimToNull(req.hotelName());
        String hotelCity = trimToNull(req.hotelCity());
        String note = trimToNull(req.note());

        if (email == null || email.length() > MAX_EMAIL || !EMAIL.matcher(email).matches()) {
            return badRequest("invalid_email", "Enter a valid email address.");
        }
        if (guestName != null && guestName.length() > MAX_NAME) {
            return badRequest("invalid_guest_name", "Your name must be " + MAX_NAME + " characters or fewer.");
        }
        if (hotelName == null || hotelName.length() > MAX_HOTEL_FIELD) {
            return badRequest("invalid_hotel_name",
                    "Enter the hotel's name, up to " + MAX_HOTEL_FIELD + " characters.");
        }
        if (hotelCity == null || hotelCity.length() > MAX_HOTEL_FIELD) {
            return badRequest("invalid_hotel_city",
                    "Enter the hotel's city, up to " + MAX_HOTEL_FIELD + " characters.");
        }
        if (note != null && note.length() > MAX_NOTE) {
            return badRequest("invalid_note", "Your note must be " + MAX_NOTE + " characters or fewer.");
        }

        ReferralService.CreateResult result = service.create(
                new ReferralService.NewReferral(email, guestName, hotelName, hotelCity, note, ip),
                clock.instant());
        if (result.created()) {
            log.info("Referral {} created for hotel '{}'", result.referral().id(), hotelName);
        } else {
            log.info("Referral {} resubmitted inside the duplicate window", result.referral().id());
        }
        return Response.status(201).entity(Map.of("id", result.referral().id())).build();
    }

    /**
     * The last X-Forwarded-For entry, else the socket address.
     *
     * <p>The Heroku router appends the address it saw the connection come from
     * to whatever X-Forwarded-For the client sent, so the last entry is the one
     * a caller cannot choose. Earlier entries are client-supplied and ignored:
     * keying on them would let a script rotate its own rate-limit key.
     *
     * <p>This holds for exactly one appending proxy in front of the API. Adding
     * another (a CDN in front of Heroku) moves the trustworthy entry and this
     * has to change with it.
     */
    static String callerIp(HttpServletRequest http) {
        if (http == null) return null;
        String forwarded = http.getHeader("X-Forwarded-For");
        if (forwarded != null) {
            String[] parts = forwarded.split(",");
            for (int i = parts.length - 1; i >= 0; i--) {
                String candidate = parts[i].trim();
                if (!candidate.isEmpty()) return candidate;
            }
        }
        return http.getRemoteAddr();
    }

    private static String trimToNull(String s) {
        if (s == null) return null;
        String t = s.trim();
        return t.isEmpty() ? null : t;
    }

    private static Response badRequest(String key, String message) {
        return Response.status(400)
                .entity(Map.of("error", key, "message", message))
                .build();
    }

    public record ReferralRequest(
            @JsonProperty("guestEmail") String guestEmail,
            @JsonProperty("guestName") String guestName,
            @JsonProperty("hotelName") String hotelName,
            @JsonProperty("hotelCity") String hotelCity,
            @JsonProperty("note") String note) {}
}
