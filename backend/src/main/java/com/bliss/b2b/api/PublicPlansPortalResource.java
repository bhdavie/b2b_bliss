package com.bliss.b2b.api;

import com.bliss.b2b.integration.StripePaymentsService;
import com.bliss.b2b.service.PlanCreationService.DemoCard;
import com.bliss.b2b.service.PlanPortalService;
import com.bliss.b2b.service.PlanPortalService.PayResult;
import com.bliss.b2b.service.PlanPortalService.PortalErrorCode;
import com.bliss.b2b.service.PlanPortalService.PortalException;
import com.bliss.b2b.service.PlanPortalService.PortalSnapshot;
import com.bliss.b2b.service.PlanPortalService.ReplaceCardResult;
import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.util.Map;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Customer portal endpoints, keyed by booking_token (reused from
 * {@code /pay/{slug}/{token}}). All operations are unauthenticated — the
 * token IS the auth grant.
 */
@Path("/api/v1/public/plans")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class PublicPlansPortalResource {

    private static final Logger log = LoggerFactory.getLogger(PublicPlansPortalResource.class);

    private final PlanPortalService portalService;
    private final StripePaymentsService stripeService;

    public PublicPlansPortalResource(
            PlanPortalService portalService,
            StripePaymentsService stripeService) {
        this.portalService = portalService;
        this.stripeService = stripeService;
    }

    @GET
    @Path("/{token}")
    public Response get(@PathParam("token") String token) {
        if (token == null || token.isBlank()) return notFound();
        Optional<PortalSnapshot> maybe = portalService.getPortal(token);
        if (maybe.isEmpty()) return notFound();
        return Response.ok(PublicPlanPortalView.from(maybe.get(), stripeService)).build();
    }

    @POST
    @Path("/{token}/pay-next")
    public Response payNext(@PathParam("token") String token) {
        try {
            PayResult result = portalService.payNextInstallment(token);
            return Response.ok(Map.of(
                    "status", "ok",
                    "paymentIntentId", result.paymentIntentId(),
                    "intentStatus", result.status())).build();
        } catch (PortalException e) {
            return mapError(e);
        } catch (RuntimeException e) {
            log.error("Unexpected error in pay-next for token={}", token, e);
            return Response.status(500).entity(Map.of("error", "internal_error")).build();
        }
    }

    @POST
    @Path("/{token}/cancel")
    public Response cancel(@PathParam("token") String token) {
        if (token == null || token.isBlank()) return notFound();
        try {
            // State transition only. The refund/fee assessment is computed and
            // logged inside CancellationService but not posted to Stripe.
            portalService.cancelPlan(token);
            return Response.ok(Map.of("status", "ok")).build();
        } catch (PortalException e) {
            return mapError(e);
        } catch (RuntimeException e) {
            log.error("Unexpected error in cancel for token={}", token, e);
            return Response.status(500).entity(Map.of("error", "internal_error")).build();
        }
    }

    @POST
    @Path("/{token}/setup-intent")
    public Response setupIntent(@PathParam("token") String token) {
        try {
            String clientSecret = portalService.createSetupIntentForCustomer(token);
            return Response.ok(Map.of("clientSecret", clientSecret)).build();
        } catch (PortalException e) {
            return mapError(e);
        } catch (RuntimeException e) {
            log.error("Unexpected error in setup-intent for token={}", token, e);
            return Response.status(500).entity(Map.of("error", "internal_error")).build();
        }
    }

    @POST
    @Path("/{token}/payment-method")
    public Response replaceCard(@PathParam("token") String token, ReplaceCardRequest req) {
        if (req == null) {
            return Response.status(400).entity(Map.of("error", "body required")).build();
        }
        try {
            DemoCard demoCard = toDemoCard(req);
            ReplaceCardResult result = portalService.replacePaymentMethod(
                    token, req.paymentMethodId(), demoCard);
            return Response.ok(Map.of(
                    "status", "ok",
                    "card", Map.of(
                            "brand", result.brand(),
                            "lastFour", result.lastFour(),
                            "expMonth", result.expMonth(),
                            "expYear", result.expYear()))).build();
        } catch (PortalException e) {
            return mapError(e);
        } catch (RuntimeException e) {
            log.error("Unexpected error in payment-method for token={}", token, e);
            return Response.status(500).entity(Map.of("error", "internal_error")).build();
        }
    }

    private static DemoCard toDemoCard(ReplaceCardRequest req) {
        if (req.demoCardLastFour() == null && req.demoCardExpMonth() == null
                && req.demoCardExpYear() == null && req.demoCardBrand() == null) {
            return null;
        }
        return new DemoCard(req.demoCardLastFour(), req.demoCardExpMonth(),
                req.demoCardExpYear(), req.demoCardBrand());
    }

    private static Response mapError(PortalException e) {
        PortalErrorCode code = e.code();
        int status = switch (code) {
            case NOT_FOUND -> 404;
            case PLAN_NOT_ACTIVE, NO_NEXT_INSTALLMENT, SETUP_INTENT_NOT_AVAILABLE_IN_DEMO -> 409;
            case NO_CARD_ON_FILE, INVALID_INPUT -> 400;
            case CARD_DECLINED, CARD_REQUIRES_ACTION -> 402;
            case STRIPE_ERROR -> 502;
        };
        log.info("Portal request rejected code={} message={}", code, e.getMessage());
        return Response.status(status).entity(Map.of(
                "error", code.name().toLowerCase(),
                "message", e.getMessage())).build();
    }

    private static Response notFound() {
        return Response.status(404).entity(Map.of(
                "error", "not_found",
                "message", "Plan not found.")).build();
    }

    public record ReplaceCardRequest(
            @JsonProperty("paymentMethodId") String paymentMethodId,
            @JsonProperty("demoCardLastFour") String demoCardLastFour,
            @JsonProperty("demoCardExpMonth") Integer demoCardExpMonth,
            @JsonProperty("demoCardExpYear") Integer demoCardExpYear,
            @JsonProperty("demoCardBrand") String demoCardBrand
    ) {}
}
