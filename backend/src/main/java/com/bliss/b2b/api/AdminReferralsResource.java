package com.bliss.b2b.api;

import com.bliss.b2b.auth.AdminPrincipal;
import com.bliss.b2b.domain.Referral;
import com.bliss.b2b.domain.ReferralStatus;
import com.bliss.b2b.domain.Referrer;
import com.bliss.b2b.integration.EmailMessage;
import com.bliss.b2b.integration.EmailService;
import com.bliss.b2b.integration.EmailTemplates;
import com.bliss.b2b.service.ReferralService;
import com.fasterxml.jackson.annotation.JsonProperty;
import io.dropwizard.auth.Auth;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.PATCH;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * The admin queue for guest referrals. Every method takes
 * {@code @Auth AdminPrincipal}, as AdminMerchantsResource does, so only the
 * {@code bliss_admin_session} cookie gets in.
 *
 * <p>One write: moving a referral along its status ladder, optionally linking
 * the merchant it became. The ladder itself is {@link ReferralStatus}; this
 * resource only maps its answer to 409.
 */
@Path("/api/v1/admin/referrals")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class AdminReferralsResource {

    private static final Logger log = LoggerFactory.getLogger(AdminReferralsResource.class);

    private final ReferralService service;
    private final EmailService emailService;
    private final String marketingBaseUrl;

    public AdminReferralsResource(
            ReferralService service, EmailService emailService, String marketingBaseUrl) {
        this.service = service;
        this.emailService = emailService;
        this.marketingBaseUrl = marketingBaseUrl == null ? "" : marketingBaseUrl.replaceAll("/$", "");
    }

    /**
     * Every referrer, newest first, each with the referrals attributed to them.
     * Admin only: this carries guest emails and magic tokens are deliberately
     * NOT included, because an admin has no reason to open a guest's page and a
     * token in a log is a token leaked.
     */
    @GET
    @Path("/referrers")
    public Response referrers(@Auth AdminPrincipal principal) {
        List<Map<String, Object>> out = service.listReferrers().stream().map(r -> {
            Map<String, Object> row = new LinkedHashMap<String, Object>();
            row.put("id", r.id().toString());
            row.put("email", r.email());
            row.put("code", r.code());
            row.put("link", marketingBaseUrl + "/hotels?ref=" + r.code());
            row.put("createdAt", r.createdAt().toString());
            row.put("referrals", service.listByReferrer(r.id()).stream()
                    .map(ReferralView::from)
                    .toList());
            return row;
        }).toList();
        return Response.ok(out).build();
    }

    @GET
    public Response list(@Auth AdminPrincipal principal, @QueryParam("status") String status) {
        ReferralStatus filter = null;
        if (status != null && !status.isBlank()) {
            try {
                filter = ReferralStatus.fromWire(status.trim());
            } catch (IllegalArgumentException e) {
                return badRequest("invalid_status",
                        "status must be one of submitted, clicked, contacted, demo_booked, live, credited, declined.");
            }
        }
        return Response.ok(service.listAll(filter).stream().map(ReferralView::from).toList()).build();
    }

    @GET
    @Path("/{id}")
    public Response detail(@Auth AdminPrincipal principal, @PathParam("id") String id) {
        UUID referralId = parseUuid(id);
        if (referralId == null) return notFound();
        return service.findById(referralId)
                .<Response>map(r -> Response.ok(ReferralView.Detail.from(r)).build())
                .orElseGet(AdminReferralsResource::notFound);
    }

    /**
     * Moves a referral to {@code status}. A merchant, when given, must exist and
     * not be a demo account, checked before the transition so a bad merchant is
     * always a 400. A move the ladder refuses is a 409 carrying the referral as
     * it stands, so the caller can re-render without a second fetch.
     */
    @PATCH
    @Path("/{id}")
    public Response update(
            @Auth AdminPrincipal principal,
            @PathParam("id") String id,
            UpdateReferralRequest req) {
        UUID referralId = parseUuid(id);
        if (referralId == null) return notFound();

        if (req == null || req.status() == null || req.status().isBlank()) {
            return badRequest("status_required", "status is required.");
        }
        ReferralStatus next;
        try {
            next = ReferralStatus.fromWire(req.status().trim());
        } catch (IllegalArgumentException e) {
            return badRequest("invalid_status",
                    "status must be one of submitted, clicked, contacted, demo_booked, live, credited, declined.");
        }

        UUID merchantId = null;
        if (req.merchantId() != null && !req.merchantId().isBlank()) {
            merchantId = parseUuid(req.merchantId().trim());
            if (merchantId == null || !service.isLinkableMerchant(merchantId)) {
                return badRequest("invalid_merchant",
                        "merchantId must reference an existing, non-demo property.");
            }
            // FIRST CLICK WINS. If this merchant is already attributed to a
            // different referral, that one keeps it. Linking here would move
            // credit to whoever an admin happened to open second, which is the
            // one thing the rule exists to stop. The full rule is in
            // ReferralService; this is the only place that can violate it,
            // because everywhere else referrer_id is write-once.
            Optional<Referral> holder = service.firstClickHolder(merchantId);
            if (holder.isPresent() && !holder.get().id().equals(referralId)) {
                return Response.status(409)
                        .entity(Map.of(
                                "error", "already_attributed",
                                "message", "That property is already credited to referral "
                                        + holder.get().id() + ", which clicked first.",
                                "referral", ReferralView.Detail.from(holder.get())))
                        .build();
            }
        }

        ReferralService.UpdateResult result = service.updateStatus(referralId, next, merchantId);
        return switch (result.outcome()) {
            case NOT_FOUND -> notFound();
            case CONFLICT -> Response.status(409)
                    .entity(Map.of(
                            "error", "invalid_transition",
                            "message", "A referral that is " + result.previous().wire()
                                    + " cannot move to " + next.wire() + ".",
                            "referral", ReferralView.Detail.from(result.referral())))
                    .build();
            case UPDATED -> {
                log.info("Admin {} moved referral {} from {} to {}{}",
                        principal.admin().email(), referralId, result.previous().wire(), next.wire(),
                        merchantId == null ? "" : " linking merchant " + merchantId);
                notifyGuest(result.referral(), next);
                yield Response.ok(ReferralView.Detail.from(result.referral())).build();
            }
        };
    }

    /**
     * One email per status that the guest cares about. The other three moves
     * (submitted, clicked, contacted) are internal bookkeeping and silent.
     *
     * <p>Sent after the transition has committed, so a Postmark failure cannot
     * roll back a status an admin has already been told took effect. That makes
     * a missed email possible; the admin can move the status again, which is a
     * no-op on the ladder but re-sends.
     *
     * <p>Requires a referrer. A V28-era referral has none, so there is no one
     * to write to and nothing is sent.
     */
    private void notifyGuest(Referral referral, ReferralStatus next) {
        if (referral.referrerId() == null) return;
        Optional<Referrer> referrer = service.findReferrerById(referral.referrerId());
        if (referrer.isEmpty()) return;

        String to = referrer.get().email();
        String statusUrl = marketingBaseUrl + "/referrals/" + referrer.get().magicToken();
        String hotel = referral.hotelName();

        EmailMessage message = switch (next) {
            case DEMO_BOOKED -> EmailTemplates.referralDemoBooked(to, hotel, statusUrl);
            case LIVE -> EmailTemplates.referralLive(to, hotel, statusUrl);
            case CREDITED -> EmailTemplates.referralCredited(to, hotel, statusUrl);
            default -> null;
        };
        if (message == null) return;

        try {
            emailService.send(message);
        } catch (RuntimeException e) {
            log.error("Referral status email ({}) failed for referral {}", next.wire(), referral.id(), e);
        }
    }

    private static UUID parseUuid(String raw) {
        try {
            return UUID.fromString(raw);
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    private static Response notFound() {
        return Response.status(404)
                .entity(Map.of("error", "referral_not_found"))
                .build();
    }

    private static Response badRequest(String key, String message) {
        return Response.status(400)
                .entity(Map.of("error", key, "message", message))
                .build();
    }

    public record UpdateReferralRequest(
            @JsonProperty("status") String status,
            @JsonProperty("merchantId") String merchantId) {}
}
