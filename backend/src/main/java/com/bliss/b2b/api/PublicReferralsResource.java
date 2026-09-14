package com.bliss.b2b.api;

import com.bliss.b2b.service.ReferralService;
import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.Context;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.time.Clock;
import java.time.Duration;
import java.util.Map;
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

    public PublicReferralsResource(ReferralService service, IpRateLimiter rateLimiter, Clock clock) {
        this.service = service;
        this.rateLimiter = rateLimiter;
        this.clock = clock;
    }

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
