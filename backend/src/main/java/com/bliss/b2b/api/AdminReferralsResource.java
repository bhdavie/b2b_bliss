package com.bliss.b2b.api;

import com.bliss.b2b.auth.AdminPrincipal;
import com.bliss.b2b.domain.ReferralStatus;
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
import java.util.Map;
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

    public AdminReferralsResource(ReferralService service) {
        this.service = service;
    }

    @GET
    public Response list(@Auth AdminPrincipal principal, @QueryParam("status") String status) {
        ReferralStatus filter = null;
        if (status != null && !status.isBlank()) {
            try {
                filter = ReferralStatus.fromWire(status.trim());
            } catch (IllegalArgumentException e) {
                return badRequest("invalid_status",
                        "status must be one of submitted, contacted, live, credited, declined.");
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
                    "status must be one of submitted, contacted, live, credited, declined.");
        }

        UUID merchantId = null;
        if (req.merchantId() != null && !req.merchantId().isBlank()) {
            merchantId = parseUuid(req.merchantId().trim());
            if (merchantId == null || !service.isLinkableMerchant(merchantId)) {
                return badRequest("invalid_merchant",
                        "merchantId must reference an existing, non-demo property.");
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
                yield Response.ok(ReferralView.Detail.from(result.referral())).build();
            }
        };
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
