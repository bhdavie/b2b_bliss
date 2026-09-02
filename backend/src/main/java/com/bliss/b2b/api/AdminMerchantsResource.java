package com.bliss.b2b.api;

import com.bliss.b2b.auth.AdminPrincipal;
import com.bliss.b2b.service.AdminMerchantsService;
import com.fasterxml.jackson.annotation.JsonProperty;
import io.dropwizard.auth.Auth;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Bliss internal admin. Every method takes {@code @Auth AdminPrincipal}, so the
 * admin auth filter has to have accepted the {@code bliss_admin_session} cookie
 * before any of this runs; a merchant or guest token cannot reach it.
 *
 * <p>Read-only apart from one append: a new fee rate. Nothing here updates or
 * deletes anything.
 */
@Path("/api/v1/admin")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class AdminMerchantsResource {

    private static final Logger log = LoggerFactory.getLogger(AdminMerchantsResource.class);

    /** Same ceiling the V27 CHECK enforces, so the 400 beats the constraint. */
    private static final BigDecimal MAX_RATE = new BigDecimal("0.25");

    private final AdminMerchantsService service;
    private final Clock clock;

    public AdminMerchantsResource(AdminMerchantsService service, Clock clock) {
        this.service = service;
        this.clock = clock;
    }

    @GET
    @Path("/merchants")
    public Response list(@Auth AdminPrincipal principal) {
        return Response.ok(service.list(clock.instant())).build();
    }

    @GET
    @Path("/merchants/{id}")
    public Response detail(@Auth AdminPrincipal principal, @PathParam("id") String id) {
        UUID merchantId = parseUuid(id);
        if (merchantId == null) return notFound();
        return service.detail(merchantId, clock.instant())
                .<Response>map(d -> Response.ok(d).build())
                .orElseGet(AdminMerchantsResource::notFound);
    }

    @GET
    @Path("/merchants/{id}/fee-rate/history")
    public Response feeRateHistory(@Auth AdminPrincipal principal, @PathParam("id") String id) {
        UUID merchantId = parseUuid(id);
        if (merchantId == null || !service.merchantExists(merchantId)) return notFound();
        return Response.ok(service.feeRateHistory(merchantId)).build();
    }

    /**
     * Appends a fee rate. Insert-only, and it cannot reorder history: an
     * effective_from earlier than the newest row on record is refused, because
     * inserting behind an existing row would silently change which rate a
     * resolution between those two instants returns.
     *
     * <p>A past effective_from is otherwise allowed — backdating to a date still
     * after the last row is a legitimate correction.
     */
    @POST
    @Path("/merchants/{id}/fee-rate")
    public Response setFeeRate(
            @Auth AdminPrincipal principal,
            @PathParam("id") String id,
            FeeRateRequest req) {
        UUID merchantId = parseUuid(id);
        if (merchantId == null || !service.merchantExists(merchantId)) return notFound();

        if (req == null || req.rate() == null) {
            return badRequest("rate_required", "rate is required.");
        }
        BigDecimal rate = req.rate();
        if (rate.signum() < 0) {
            return badRequest("rate_out_of_range", "rate must be at least 0.");
        }
        if (rate.compareTo(MAX_RATE) > 0) {
            return badRequest("rate_out_of_range", "rate must be at most 0.25.");
        }

        Instant effectiveFrom;
        if (req.effectiveFrom() == null || req.effectiveFrom().isBlank()) {
            effectiveFrom = clock.instant();
        } else {
            try {
                effectiveFrom = Instant.parse(req.effectiveFrom().trim());
            } catch (DateTimeParseException e) {
                return badRequest("effective_from_invalid",
                        "effectiveFrom must be an ISO-8601 instant, for example 2026-09-02T12:00:00Z.");
            }
        }

        Optional<Instant> latest = service.latestEffectiveFrom(merchantId);
        if (latest.isPresent() && effectiveFrom.isBefore(latest.get())) {
            return badRequest("effective_from_before_latest",
                    "effectiveFrom " + effectiveFrom + " is earlier than the most recent rate on "
                            + "record (" + latest.get() + "). Rates are append-only, so a new row "
                            + "cannot be inserted behind an existing one.");
        }

        AdminMerchantsService.FeeRateRow created = service.insertRate(
                merchantId, rate, effectiveFrom, trimToNull(req.note()), principal.admin().id());
        log.info("Admin {} set fee rate {} for merchant {} effective {}",
                principal.admin().email(), rate, merchantId, effectiveFrom);
        return Response.status(201).entity(created).build();
    }

    private static UUID parseUuid(String raw) {
        try {
            return UUID.fromString(raw);
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    private static String trimToNull(String s) {
        if (s == null) return null;
        String t = s.trim();
        return t.isEmpty() ? null : t;
    }

    private static Response notFound() {
        return Response.status(404)
                .entity(Map.of("error", "merchant_not_found"))
                .build();
    }

    private static Response badRequest(String key, String message) {
        return Response.status(400)
                .entity(Map.of("error", key, "message", message))
                .build();
    }

    public record FeeRateRequest(
            @JsonProperty("rate") BigDecimal rate,
            @JsonProperty("note") String note,
            @JsonProperty("effectiveFrom") String effectiveFrom) {}
}
