package com.bliss.b2b.api;

import com.bliss.b2b.payments.PlanFrequency;
import com.bliss.b2b.service.PlanCreationException;
import com.bliss.b2b.service.PlanCreationException.Reason;
import com.bliss.b2b.service.PlanCreationService;
import com.bliss.b2b.service.PlanCreationService.CreatePlanInput;
import com.bliss.b2b.service.PlanCreationService.PlanCreationResult;
import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

@Path("/api/v1/public/plans")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class PublicPlansResource {

    private static final Logger log = LoggerFactory.getLogger(PublicPlansResource.class);

    private final PlanCreationService planCreationService;

    public PublicPlansResource(PlanCreationService planCreationService) {
        this.planCreationService = planCreationService;
    }

    @POST
    public Response create(CreatePlanRequest req) {
        if (req == null) {
            return Response.status(400).entity(Map.of("error", "body required")).build();
        }
        PlanFrequency frequency;
        try {
            frequency = PlanFrequency.fromWire(req.frequency());
        } catch (IllegalArgumentException e) {
            return Response.status(400).entity(Map.of(
                    "error", "invalid_frequency",
                    "message", "frequency must be one of biweekly, monthly")).build();
        }

        try {
            PlanCreationResult result = planCreationService.createPlan(new CreatePlanInput(
                    req.merchantSlug(),
                    req.bookingToken(),
                    req.customerEmail(),
                    req.customerFirstName(),
                    req.customerLastName(),
                    req.paymentMethodId(),
                    frequency));
            return Response.status(201).entity(toView(result)).build();
        } catch (PlanCreationException e) {
            return mapError(e);
        } catch (RuntimeException e) {
            log.error("Unexpected error creating plan", e);
            return Response.status(500).entity(Map.of("error", "internal_error")).build();
        }
    }

    private static Response mapError(PlanCreationException e) {
        int status = switch (e.reason()) {
            case BOOKING_NOT_FOUND -> 404;
            case BOOKING_NOT_OPEN -> 409;
            case STRIPE_NOT_CONFIGURED -> 503;
            case CARD_DECLINED, CARD_REQUIRES_ACTION -> 402;
            case MERCHANT_NOT_READY -> 409;
            case ELIGIBILITY_FAILED -> 422;
            case STRIPE_ERROR -> 502;
            case INVALID_INPUT -> 400;
        };
        log.info("Plan creation rejected reason={} message={}", e.reason(), e.getMessage());
        return Response.status(status).entity(Map.of(
                "error", e.reason().name().toLowerCase(),
                "message", e.getMessage())).build();
    }

    private static CreatePlanResponse toView(PlanCreationResult result) {
        List<ScheduleEntryView> schedule = result.schedule().stream()
                .map(s -> new ScheduleEntryView(
                        s.sequence(),
                        s.dueDate(),
                        s.amountCents(),
                        s.status().wire(),
                        s.kind().wire()))
                .toList();
        return new CreatePlanResponse(
                result.planId().toString(),
                result.booking().id().toString(),
                result.plan().frequency().wire(),
                result.plan().numPayments(),
                result.plan().totalAmountCents(),
                result.plan().depositAmountCents(),
                schedule,
                result.firstChargeIntentId(),
                result.firstChargeStatus());
    }

    public record CreatePlanRequest(
            @JsonProperty("merchantSlug") String merchantSlug,
            @JsonProperty("bookingToken") String bookingToken,
            @JsonProperty("customerEmail") String customerEmail,
            @JsonProperty("customerFirstName") String customerFirstName,
            @JsonProperty("customerLastName") String customerLastName,
            @JsonProperty("paymentMethodId") String paymentMethodId,
            @JsonProperty("frequency") String frequency
    ) {}

    public record CreatePlanResponse(
            String planId,
            String bookingId,
            String frequency,
            int numPayments,
            long totalAmountCents,
            long depositAmountCents,
            List<ScheduleEntryView> schedule,
            String firstChargeIntentId,
            String firstChargeStatus
    ) {}

    public record ScheduleEntryView(
            int sequence,
            LocalDate dueDate,
            long amountCents,
            String status,
            String kind
    ) {}
}
