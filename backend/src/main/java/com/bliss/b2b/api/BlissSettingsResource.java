package com.bliss.b2b.api;

import com.bliss.b2b.auth.MerchantPrincipal;
import com.bliss.b2b.service.BlissSettingsService;
import com.bliss.b2b.service.BlissSettingsService.SettingsException;
import com.fasterxml.jackson.annotation.JsonProperty;
import io.dropwizard.auth.Auth;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.PUT;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.util.Map;

/**
 * The property's Bliss settings in one place (configurable-property spec,
 * sections 4 and 9). GET lists every setting with its value and source; PUT
 * changes the ones Bliss owns; enable switches Bliss on with defaults.
 */
@Path("/api/v1/merchants/me")
@Produces(MediaType.APPLICATION_JSON)
public class BlissSettingsResource {

    private final BlissSettingsService settings;

    public BlissSettingsResource(BlissSettingsService settings) {
        this.settings = settings;
    }

    @GET
    @Path("/bliss-settings")
    public BlissSettingsService.SettingsView get(@Auth MerchantPrincipal principal) {
        return settings.view(principal.merchant());
    }

    @PUT
    @Path("/bliss-settings")
    @Consumes(MediaType.APPLICATION_JSON)
    public Response update(@Auth MerchantPrincipal principal, UpdateRequest req) {
        if (req == null) {
            return Response.status(400).entity(Map.of("error", "body required")).build();
        }
        try {
            return Response.ok(settings.update(principal.merchant(),
                    req.payoutMode(), req.releasePolicy(), req.chargebackBufferDays())).build();
        } catch (SettingsException e) {
            int status = "hold_mode_unavailable".equals(e.code()) ? 409 : 400;
            return Response.status(status).entity(Map.of("error", e.code(), "message", e.getMessage())).build();
        }
    }

    @POST
    @Path("/bliss/enable")
    public BlissSettingsService.SettingsView enable(@Auth MerchantPrincipal principal) {
        return settings.enable(principal.merchant());
    }

    public record UpdateRequest(
            @JsonProperty("payoutMode") String payoutMode,
            @JsonProperty("releasePolicy") String releasePolicy,
            @JsonProperty("chargebackBufferDays") Integer chargebackBufferDays) {
    }
}
