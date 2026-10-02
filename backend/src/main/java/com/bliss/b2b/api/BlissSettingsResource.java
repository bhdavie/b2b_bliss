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
    /** "Switch Bliss on" at the end of setup; null falls back to just enabling. */
    private final com.bliss.b2b.service.BlissOnboardingService onboarding;

    public BlissSettingsResource(BlissSettingsService settings) {
        this(settings, null);
    }

    public BlissSettingsResource(BlissSettingsService settings,
            com.bliss.b2b.service.BlissOnboardingService onboarding) {
        this.settings = settings;
        this.onboarding = onboarding;
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
            BlissSettingsService.SettingsView view = settings.update(principal.merchant(),
                    req.payoutMode(), req.releasePolicy(), req.chargebackBufferDays(),
                    req.feeServiceId(), req.feeTaxCode(), req.feeAccountingCategoryId());
            if (req.weeklySummary() != null) {
                if (!"on".equals(req.weeklySummary()) && !"off".equals(req.weeklySummary())) {
                    throw new SettingsException("invalid_setting", "Choose on or off.");
                }
                view = settings.setWeeklySummary(principal.merchant(), "on".equals(req.weeklySummary()));
            }
            if (req.ledgerPaymentType() != null) {
                view = settings.setLedgerPaymentType(principal.merchant(), req.ledgerPaymentType());
            }
            return Response.ok(view).build();
        } catch (SettingsException e) {
            // Not ready for hold mode is a conflict with the property's state, not a bad request.
            int status = java.util.Set.of("hold_mode_unavailable", "express_onboarding_required",
                    "hold_mode_us_only").contains(e.code()) ? 409
                    : "stripe_setup_failed".equals(e.code()) ? 502 : 400;
            return Response.status(status).entity(Map.of("error", e.code(), "message", e.getMessage())).build();
        }
    }

    @POST
    @Path("/bliss/enable")
    public Response enable(@Auth MerchantPrincipal principal) {
        if (onboarding == null) {
            return Response.ok(settings.enable(principal.merchant())).build();
        }
        try {
            return Response.ok(onboarding.switchOn(principal.merchant())).build();
        } catch (SettingsException e) {
            return Response.status(409).entity(Map.of("error", e.code(), "message", e.getMessage())).build();
        } catch (com.bliss.b2b.service.PropertyOnboardingException e) {
            return Response.status(409).entity(Map.of("error", "setup_incomplete",
                    "message", e.getMessage())).build();
        }
    }

    public record UpdateRequest(
            @JsonProperty("payoutMode") String payoutMode,
            @JsonProperty("releasePolicy") String releasePolicy,
            @JsonProperty("chargebackBufferDays") Integer chargebackBufferDays,
            @JsonProperty("feeServiceId") String feeServiceId,
            @JsonProperty("feeTaxCode") String feeTaxCode,
            @JsonProperty("feeAccountingCategoryId") String feeAccountingCategoryId,
            @JsonProperty("ledgerPaymentType") String ledgerPaymentType,
            @JsonProperty("weeklySummary") String weeklySummary) {
    }
}
