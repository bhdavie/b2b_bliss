package com.bliss.b2b.api;

import com.bliss.b2b.payments.PlanFrequency;
import com.bliss.b2b.service.MewsStayService;
import com.bliss.b2b.service.MewsStayService.MewsStayException;
import com.bliss.b2b.service.PlanCreationException;
import com.bliss.b2b.service.PlanCreationException.Reason;
import com.bliss.b2b.service.PlanCreationService;
import com.bliss.b2b.service.PlanCreationService.CustomerCheckoutInput;
import com.bliss.b2b.service.PlanCreationService.DemoCard;
import com.bliss.b2b.service.PlanCreationService.PlanCreationResult;
import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Customer-initiated checkout endpoint (Phase 13). The customer lands at
 * {@code /checkout/{slug}} from the merchant's own checkout page with
 * cart details in the URL, picks a plan, enters a card, and POSTs here.
 *
 * <p>The merchant's actual plan rules are loaded server-side and the
 * eligibility math runs against them — the client cannot lie about
 * eligible frequencies or skip the deposit. The booking is created
 * inline with {@code source = customer_initiated} and shows up in the
 * merchant's existing Bookings dashboard with a "From checkout link"
 * badge for manual reconciliation.
 */
@Path("/api/v1/public/checkout")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class PublicCheckoutResource {

    private static final Logger log = LoggerFactory.getLogger(PublicCheckoutResource.class);

    private final PlanCreationService planCreationService;
    private final MewsStayService mewsStayService;

    public PublicCheckoutResource(PlanCreationService planCreationService, MewsStayService mewsStayService) {
        this.planCreationService = planCreationService;
        this.mewsStayService = mewsStayService;
    }

    /**
     * Mews rail: the room list, whether the chosen room is free for every night,
     * and Mews' price for the property's Bliss rate. The checkout page builds
     * its plan preview from this total, never from the URL's. Plan creation
     * prices again, fresh, and that is the figure the plan is written against.
     *
     * <p>{@code categoryId} wins over {@code room}, the booking engine's room
     * label; with neither matching, the response lists rooms to choose from.
     */
    @GET
    @Path("/{slug}/quote")
    public Response quote(@PathParam("slug") String slug,
                          @QueryParam("checkin") String checkin,
                          @QueryParam("checkout") String checkout,
                          @QueryParam("categoryId") String categoryId,
                          @QueryParam("room") String room,
                          @QueryParam("adults") Integer adults) {
        try {
            return Response.ok(mewsStayService.quote(
                    slug, parseDate(checkin), parseDate(checkout), categoryId, room, adults)).build();
        } catch (MewsStayException e) {
            int status = switch (e.code()) {
                case "not_found" -> 404;
                case "not_mews_rail", "not_ready", "currency_mismatch" -> 409;
                case "mews_unreachable" -> 502;
                default -> 400;
            };
            return Response.status(status).entity(Map.of("error", e.code(), "message", e.getMessage())).build();
        }
    }

    @POST
    public Response create(CheckoutRequest req) {
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
        LocalDate checkin = parseDate(req.appointmentDate());
        if (checkin == null) {
            return Response.status(400).entity(Map.of(
                    "error", "invalid_appointment_date",
                    "message", "appointmentDate must be yyyy-MM-dd")).build();
        }
        LocalDate checkout = req.checkoutDate() == null || req.checkoutDate().isBlank()
                ? null : parseDate(req.checkoutDate());
        if (req.checkoutDate() != null && !req.checkoutDate().isBlank() && checkout == null) {
            return Response.status(400).entity(Map.of(
                    "error", "invalid_checkout_date",
                    "message", "checkoutDate must be yyyy-MM-dd")).build();
        }

        try {
            PlanCreationResult result = planCreationService.createBookingAndPlan(
                    new CustomerCheckoutInput(
                            req.merchantSlug(),
                            req.totalAmountCents() == null ? 0L : req.totalAmountCents(),
                            checkin,
                            checkout,
                            req.description(),
                            req.customerName(),
                            req.customerFirstName(),
                            req.customerLastName(),
                            req.customerEmail(),
                            req.customerPhone(),
                            req.paymentMethodId(),
                            frequency,
                            toDemoCard(req),
                            req.mewsResourceCategoryId(),
                            req.adultCount()));
            return Response.status(201).entity(toView(result)).build();
        } catch (PlanCreationException e) {
            return mapError(e);
        } catch (RuntimeException e) {
            log.error("Unexpected error creating checkout plan", e);
            return Response.status(500).entity(Map.of("error", "internal_error")).build();
        }
    }

    private static LocalDate parseDate(String iso) {
        if (iso == null || iso.isBlank()) return null;
        try {
            return LocalDate.parse(iso);
        } catch (DateTimeParseException e) {
            return null;
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
            case STAY_UNAVAILABLE -> 409;
            case PMS_UNAVAILABLE -> 502;
        };
        log.info("Checkout rejected reason={} message={}", e.reason(), e.getMessage());
        return Response.status(status).entity(Map.of(
                "error", e.reason().name().toLowerCase(),
                "message", e.getMessage())).build();
    }

    private static CheckoutResponse toView(PlanCreationResult result) {
        List<ScheduleEntryView> schedule = result.schedule().stream()
                .map(s -> new ScheduleEntryView(
                        s.sequence(),
                        s.dueDate(),
                        s.amountCents(),
                        s.status().wire(),
                        s.kind().wire()))
                .toList();
        return new CheckoutResponse(
                result.booking().id().toString(),
                result.booking().bookingToken(),
                result.planId().toString(),
                result.plan().frequency().wire(),
                result.plan().numPayments(),
                result.plan().totalAmountCents(),
                result.booking().originalTotalAmountCents(),
                result.plan().depositAmountCents(),
                schedule,
                result.firstChargeIntentId(),
                result.firstChargeStatus());
    }

    private static DemoCard toDemoCard(CheckoutRequest req) {
        if (req.demoCardLastFour() == null && req.demoCardExpMonth() == null
                && req.demoCardExpYear() == null && req.demoCardBrand() == null) {
            return null;
        }
        return new DemoCard(req.demoCardLastFour(), req.demoCardExpMonth(),
                req.demoCardExpYear(), req.demoCardBrand());
    }

    public record CheckoutRequest(
            @JsonProperty("merchantSlug") String merchantSlug,
            @JsonProperty("totalAmountCents") Long totalAmountCents,
            @JsonProperty("appointmentDate") String appointmentDate,
            @JsonProperty("checkoutDate") String checkoutDate,
            @JsonProperty("description") String description,
            @JsonProperty("customerName") String customerName,
            @JsonProperty("customerFirstName") String customerFirstName,
            @JsonProperty("customerLastName") String customerLastName,
            @JsonProperty("customerEmail") String customerEmail,
            @JsonProperty("customerPhone") String customerPhone,
            @JsonProperty("paymentMethodId") String paymentMethodId,
            @JsonProperty("frequency") String frequency,
            @JsonProperty("demoCardLastFour") String demoCardLastFour,
            @JsonProperty("demoCardExpMonth") Integer demoCardExpMonth,
            @JsonProperty("demoCardExpYear") Integer demoCardExpYear,
            @JsonProperty("demoCardBrand") String demoCardBrand,
            @JsonProperty("mewsResourceCategoryId") String mewsResourceCategoryId,
            @JsonProperty("adultCount") Integer adultCount
    ) {}

    public record CheckoutResponse(
            String bookingId,
            String bookingToken,
            String planId,
            String frequency,
            int numPayments,
            long totalAmountCents,
            Long originalTotalAmountCents,
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
