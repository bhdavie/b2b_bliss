package com.bliss.b2b.api;

import com.bliss.b2b.integration.StripeConnectService;
import com.bliss.b2b.integration.StripeNotConfiguredException;
import com.bliss.b2b.service.DisputeService;
import com.stripe.exception.SignatureVerificationException;
import com.stripe.model.Event;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.HeaderParam;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Stripe events about Bliss's own platform account, on their own endpoint
 * with their own signing secret ({@code STRIPE_PLATFORM_WEBHOOK_SECRET}). The
 * Connect endpoint, {@code /stripe/webhooks}, receives events about the
 * properties' connected accounts; disputes are raised on the platform, where
 * Bliss's charges are made, so they arrive here. Only
 * {@code charge.dispute.*} is acted on; anything else is acknowledged.
 */
@Path("/api/v1/stripe/platform-webhooks")
@Produces(MediaType.APPLICATION_JSON)
public class StripePlatformWebhookResource {

    private static final Logger log = LoggerFactory.getLogger(StripePlatformWebhookResource.class);

    private final StripeConnectService stripe;
    private final DisputeService disputes;

    public StripePlatformWebhookResource(StripeConnectService stripe, DisputeService disputes) {
        this.stripe = stripe;
        this.disputes = disputes;
    }

    @POST
    @Consumes(MediaType.APPLICATION_JSON)
    public Response webhook(@HeaderParam("Stripe-Signature") String signatureHeader, String payload) {
        Event event;
        try {
            event = stripe.parsePlatformWebhookEvent(payload, signatureHeader);
        } catch (StripeNotConfiguredException e) {
            return Response.status(503).entity(Map.of("error", "stripe_not_configured",
                    "message", "Set STRIPE_PLATFORM_WEBHOOK_SECRET on the backend.")).build();
        } catch (SignatureVerificationException e) {
            log.warn("Stripe platform webhook signature verification failed: {}", e.getMessage());
            return Response.status(400).entity(Map.of("error", "invalid_signature")).build();
        }
        log.info("Received Stripe platform webhook event id={} type={}", event.getId(), event.getType());
        String type = event.getType();
        if (type == null || !type.startsWith("charge.dispute.")) {
            return Response.ok(Map.of("received", true)).build();
        }
        String raw = event.getDataObjectDeserializer() == null ? null
                : event.getDataObjectDeserializer().getRawJson();
        if (raw == null || raw.isBlank()) {
            log.warn("Dispute event {} carries no dispute; ignored", event.getId());
            return Response.ok(Map.of("received", true)).build();
        }
        try {
            DisputeService.Outcome outcome = disputes.apply(type, raw);
            return Response.ok(Map.of("received", true, "outcome", outcome.name().toLowerCase())).build();
        } catch (RuntimeException e) {
            // Ask Stripe to retry: a dispute must not be lost to a transient failure.
            log.error("Dispute event {} could not be recorded: {}", event.getId(), e.toString());
            return Response.status(500).entity(Map.of("error", "dispute_not_recorded")).build();
        }
    }
}
