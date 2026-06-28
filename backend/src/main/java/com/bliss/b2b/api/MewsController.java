package com.bliss.b2b.api;

import com.bliss.b2b.integration.MewsApiClient;
import com.bliss.b2b.integration.MewsApiClient.ConnectionInfo;
import com.bliss.b2b.integration.MewsApiException;
import com.bliss.b2b.service.MewsSyncService;
import com.bliss.b2b.service.MewsSyncService.SyncSummary;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.WebApplicationException;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Demo endpoint that pulls reservations from Mews and imports the
 * plan-eligible ones as Bliss bookings + payment plans, returning a summary
 * of what happened. Also exposes a read-only "connection" probe used by the
 * simulated Mews Marketplace install. Mews is a v2-list integration wired in
 * for the demo only.
 */
@Path("/api/v1/mews")
@Produces(MediaType.APPLICATION_JSON)
public class MewsController {

    private static final Logger log = LoggerFactory.getLogger(MewsController.class);

    private final MewsSyncService mewsSyncService;
    private final MewsApiClient mewsApiClient;

    public MewsController(MewsSyncService mewsSyncService, MewsApiClient mewsApiClient) {
        this.mewsSyncService = mewsSyncService;
        this.mewsApiClient = mewsApiClient;
    }

    /**
     * Read-only probe that confirms the .env credentials resolve to a live Mews
     * enterprise, surfacing its name/city. Used by the marketplace install to
     * show a genuine "connected" confirmation. Never errors the flow: on any
     * upstream failure it returns {@code connected: false} rather than a 5xx.
     */
    @GET
    @Path("/marketplace/connection")
    public Map<String, Object> connection() {
        try {
            ConnectionInfo info = mewsApiClient.fetchConnectionInfo();
            return Map.of(
                    "connected", true,
                    "enterpriseName", nullToEmpty(info.enterpriseName()),
                    "city", nullToEmpty(info.city()),
                    "countryCode", nullToEmpty(info.countryCode()));
        } catch (MewsApiException e) {
            log.warn("Mews connection probe failed: {}", e.getMessage());
            return Map.of("connected", false);
        }
    }

    private static String nullToEmpty(String s) {
        return s == null ? "" : s;
    }

    @POST
    @Path("/sync")
    public SyncSummary sync() {
        try {
            return mewsSyncService.sync();
        } catch (MewsApiException e) {
            // Surface the upstream failure as a 502 rather than a generic 500;
            // the cause is an external dependency, not our handler.
            throw new WebApplicationException(e.getMessage(), Response.Status.BAD_GATEWAY);
        }
    }
}
