package com.bliss.b2b.api;

import com.bliss.b2b.auth.MerchantPrincipal;
import com.bliss.b2b.domain.PmsType;
import com.bliss.b2b.service.PropertyOnboardingException;
import com.bliss.b2b.service.PropertyOnboardingService;
import com.bliss.b2b.service.PropertyOnboardingService.MewsConnectResult;
import com.fasterxml.jackson.annotation.JsonProperty;
import io.dropwizard.auth.Auth;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.util.Map;

/**
 * Property self-serve onboarding: read progress, pick a PMS, connect Mews, and
 * go live. All endpoints are merchant-scoped through {@code @Auth} — they act on
 * the authenticated property only.
 */
@Path("/api/v1/merchants/me/onboarding")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class PropertyOnboardingResource {

    private final PropertyOnboardingService service;

    public PropertyOnboardingResource(PropertyOnboardingService service) {
        this.service = service;
    }

    @GET
    public Response status(@Auth MerchantPrincipal principal) {
        return Response.ok(service.status(principal.merchant())).build();
    }

    @POST
    @Path("/pms")
    public Response selectPms(@Auth MerchantPrincipal principal, SelectPmsRequest req) {
        if (req == null || req.pmsType() == null || req.pmsType().isBlank()) {
            return badRequest("invalid_input", "pmsType required");
        }
        PmsType pmsType;
        try {
            pmsType = PmsType.fromWire(req.pmsType());
        } catch (IllegalArgumentException e) {
            return badRequest("invalid_input", "pmsType must be one of stripe, mews, cloudbeds");
        }
        return Response.ok(service.selectPms(principal.merchant(), pmsType)).build();
    }

    @POST
    @Path("/pms/mews/connect")
    public Response connectMews(@Auth MerchantPrincipal principal, ConnectMewsRequest req) {
        if (req == null) {
            return badRequest("invalid_input", "body required");
        }
        try {
            MewsConnectResult result = service.connectMews(
                    principal.merchant(), req.platformUrl(), req.clientToken(), req.accessToken());
            return Response.ok(result).build();
        } catch (PropertyOnboardingException e) {
            return badRequest(e.code(), e.getMessage());
        }
    }

    @POST
    @Path("/pms/mews/disconnect")
    public Response disconnectMews(@Auth MerchantPrincipal principal) {
        return Response.ok(service.disconnectMews(principal.merchant())).build();
    }

    @POST
    @Path("/activate")
    public Response activate(@Auth MerchantPrincipal principal) {
        try {
            return Response.ok(service.activate(principal.merchant())).build();
        } catch (PropertyOnboardingException e) {
            // setup not complete -> 409 conflict (state precondition unmet)
            return Response.status(409)
                    .entity(Map.of("error", e.code(), "message", e.getMessage()))
                    .build();
        }
    }

    private static Response badRequest(String code, String message) {
        return Response.status(400).entity(Map.of("error", code, "message", message)).build();
    }

    public record SelectPmsRequest(@JsonProperty("pmsType") String pmsType) {
    }

    public record ConnectMewsRequest(
            @JsonProperty("platformUrl") String platformUrl,
            @JsonProperty("clientToken") String clientToken,
            @JsonProperty("accessToken") String accessToken) {
    }
}
