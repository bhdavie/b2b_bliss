package com.bliss.b2b.api;

import com.bliss.b2b.auth.MerchantPrincipal;
import com.bliss.b2b.payments.AllowedFrequencies;
import com.bliss.b2b.payments.MerchantPlanRules;
import com.bliss.b2b.payments.PlanFrequency;
import com.bliss.b2b.service.MerchantPlanRulesService;
import com.fasterxml.jackson.annotation.JsonProperty;
import io.dropwizard.auth.Auth;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.PUT;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.util.Map;

/**
 * Merchant-facing CRUD for plan eligibility rules. GET returns the effective
 * rules (defaults if no row stored); PUT upserts. Only the authenticated
 * merchant can see or modify their own rules.
 */
@Path("/api/v1/merchants/me/plan-rules")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class PlanRulesResource {

    private static final int MAX_WEEKS = 520;
    private static final long MAX_AMOUNT_CENTS = 1_000_000_000L; // $10M cap, defensive

    private final MerchantPlanRulesService service;

    public PlanRulesResource(MerchantPlanRulesService service) {
        this.service = service;
    }

    @GET
    public PlanRulesView get(@Auth MerchantPrincipal principal) {
        return PlanRulesView.from(service.forMerchant(principal.merchant().id()));
    }

    @PUT
    public Response upsert(@Auth MerchantPrincipal principal, PlanRulesRequest req) {
        if (req == null) {
            return badRequest("body required");
        }
        if (req.minLeadTimeWeeks() == null) {
            return badRequest("minLeadTimeWeeks required");
        }
        int minLead = req.minLeadTimeWeeks();
        if (minLead < 0 || minLead > MAX_WEEKS) {
            return badRequest("minLeadTimeWeeks must be 0-" + MAX_WEEKS);
        }
        Integer maxLead = req.maxLeadTimeWeeks();
        if (maxLead != null && (maxLead < 1 || maxLead > MAX_WEEKS)) {
            return badRequest("maxLeadTimeWeeks must be 1-" + MAX_WEEKS);
        }
        if (maxLead != null && maxLead < minLead) {
            return badRequest("maxLeadTimeWeeks must be >= minLeadTimeWeeks");
        }
        AllowedFrequencies allowed;
        try {
            allowed = AllowedFrequencies.fromWire(req.allowedFrequencies());
        } catch (IllegalArgumentException e) {
            return badRequest("allowedFrequencies must be one of monthly, biweekly, both");
        }
        Long minAmt = req.minBookingAmountCents();
        if (minAmt != null && (minAmt <= 0 || minAmt > MAX_AMOUNT_CENTS)) {
            return badRequest("minBookingAmountCents must be positive");
        }
        Long maxAmt = req.maxBookingAmountCents();
        if (maxAmt != null && (maxAmt <= 0 || maxAmt > MAX_AMOUNT_CENTS)) {
            return badRequest("maxBookingAmountCents must be positive");
        }
        if (minAmt != null && maxAmt != null && maxAmt < minAmt) {
            return badRequest("maxBookingAmountCents must be >= minBookingAmountCents");
        }
        PlanFrequency recommended = null;
        if (req.recommendedFrequency() != null && !req.recommendedFrequency().isBlank()) {
            try {
                recommended = PlanFrequency.fromWire(req.recommendedFrequency());
            } catch (IllegalArgumentException e) {
                return badRequest("recommendedFrequency must be one of monthly, biweekly");
            }
            // Recommended must be allowed.
            if (!allowed.includes(recommended)) {
                return badRequest("recommendedFrequency must be permitted by allowedFrequencies");
            }
        }

        MerchantPlanRules rules = new MerchantPlanRules(
                minLead, maxLead, allowed, minAmt, maxAmt, recommended);
        service.save(principal.merchant().id(), rules);
        return Response.ok(PlanRulesView.from(rules)).build();
    }

    private static Response badRequest(String message) {
        return Response.status(400).entity(Map.of("error", message)).build();
    }

    public record PlanRulesRequest(
            @JsonProperty("minLeadTimeWeeks") Integer minLeadTimeWeeks,
            @JsonProperty("maxLeadTimeWeeks") Integer maxLeadTimeWeeks,
            @JsonProperty("allowedFrequencies") String allowedFrequencies,
            @JsonProperty("minBookingAmountCents") Long minBookingAmountCents,
            @JsonProperty("maxBookingAmountCents") Long maxBookingAmountCents,
            @JsonProperty("recommendedFrequency") String recommendedFrequency
    ) {}
}
