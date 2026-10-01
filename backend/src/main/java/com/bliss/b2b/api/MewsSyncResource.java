package com.bliss.b2b.api;

import com.bliss.b2b.auth.MerchantPrincipal;
import com.bliss.b2b.domain.BlissRate;
import com.bliss.b2b.domain.PmsType;
import com.bliss.b2b.payments.BookingType;
import com.bliss.b2b.persistence.BlissRateDao;
import com.bliss.b2b.persistence.MewsSyncRunDao;
import com.bliss.b2b.service.MewsSyncService;
import com.fasterxml.jackson.annotation.JsonProperty;
import io.dropwizard.auth.Auth;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.PUT;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.time.Instant;
import java.util.List;
import java.util.Map;

/**
 * What Bliss has synced from the property's Mews (configurable-property spec,
 * section 5): the last sync, each Bliss rate with its cancellation terms and
 * booking type, a "Resync now", and the hotel's booking type override.
 */
@Path("/api/v1/merchants/me")
@Produces(MediaType.APPLICATION_JSON)
public class MewsSyncResource {

    private final MewsSyncService syncService;
    private final BlissRateDao rateDao;
    private final MewsSyncRunDao runDao;

    public MewsSyncResource(MewsSyncService syncService, BlissRateDao rateDao, MewsSyncRunDao runDao) {
        this.syncService = syncService;
        this.rateDao = rateDao;
        this.runDao = runDao;
    }

    @GET
    @Path("/mews-sync")
    public Response get(@Auth MerchantPrincipal principal) {
        if (principal.merchant().pmsType() != PmsType.MEWS) {
            return notMews();
        }
        return Response.ok(view(principal)).build();
    }

    @POST
    @Path("/mews-sync")
    public Response resync(@Auth MerchantPrincipal principal) {
        if (principal.merchant().pmsType() != PmsType.MEWS) {
            return notMews();
        }
        MewsSyncService.Result result = syncService.sync(principal.merchant().id());
        if (!result.ok()) {
            return Response.status(502).entity(Map.of("error", "mews_sync_failed",
                    "message", "Bliss couldn't read your setup from Mews just now. Try again in a minute.")).build();
        }
        return Response.ok(view(principal)).build();
    }

    @PUT
    @Path("/bliss-rates/{rateId}/booking-type")
    @Consumes(MediaType.APPLICATION_JSON)
    public Response setBookingType(@Auth MerchantPrincipal principal, @PathParam("rateId") String rateId,
            BookingTypeRequest req) {
        String override = req == null ? null : req.bookingType();
        if (override != null) {
            try {
                override = BookingType.fromWire(override).wire();
            } catch (IllegalArgumentException e) {
                return Response.status(400).entity(Map.of("error", "invalid_booking_type",
                        "message", "Choose refundable or non_refundable, or null to follow Mews.")).build();
            }
        }
        if (rateDao.setOverride(principal.merchant().id(), rateId, override) != 1) {
            return Response.status(404).entity(Map.of("error", "not_a_bliss_rate")).build();
        }
        return Response.ok(view(principal)).build();
    }

    private SyncView view(MerchantPrincipal principal) {
        var last = runDao.latest(principal.merchant().id()).orElse(null);
        List<RateView> rates = rateDao.listForMerchant(principal.merchant().id()).stream()
                .map(MewsSyncResource::rateView).toList();
        return new SyncView(
                last == null ? null : last.finishedAt(),
                last == null ? null : last.error(),
                rates);
    }

    private static RateView rateView(BlissRate r) {
        return new RateView(r.mewsRateId(), r.rateName() == null ? null : r.rateName().trim(), r.frequency().wire(),
                r.active(), r.bookingType().wire(), r.derivedType().wire(),
                r.override() == null ? null : r.override().wire(),
                r.syncedAt() == null ? null : r.terms().describe(), r.syncedAt());
    }

    private static Response notMews() {
        return Response.status(409).entity(Map.of("error", "not_mews",
                "message", "Syncing applies to properties connected to Mews.")).build();
    }

    public record SyncView(Instant lastSyncedAt, String lastError, List<RateView> rates) {
    }

    public record RateView(String rateId, String name, String frequency, boolean bookable, String bookingType,
            String bookingTypeFromMews, String bookingTypeOverride, String cancellationTerms, Instant syncedAt) {
    }

    public record BookingTypeRequest(@JsonProperty("bookingType") String bookingType) {
    }
}
