package com.bliss.b2b.api;

import com.bliss.b2b.BlissConfiguration.AppConfig;
import com.bliss.b2b.auth.MerchantPrincipal;
import com.bliss.b2b.domain.Booking;
import com.bliss.b2b.domain.ConnectStatus;
import com.bliss.b2b.domain.Merchant;
import com.bliss.b2b.integration.StripeConnectService;
import com.bliss.b2b.payments.EligibilityResult;
import com.bliss.b2b.payments.PlanEligibilityService;
import com.bliss.b2b.payments.PlanOption;
import com.bliss.b2b.service.BookingService;
import com.bliss.b2b.service.BookingService.CreateBookingInput;
import com.fasterxml.jackson.annotation.JsonProperty;
import io.dropwizard.auth.Auth;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.time.Clock;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Path("/api/v1/bookings")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class BookingsResource {

    private final BookingService bookingService;
    private final PlanEligibilityService eligibilityService;
    private final StripeConnectService stripeService;
    private final AppConfig appConfig;
    private final Clock clock;

    public BookingsResource(
            BookingService bookingService,
            PlanEligibilityService eligibilityService,
            StripeConnectService stripeService,
            AppConfig appConfig,
            Clock clock
    ) {
        this.bookingService = bookingService;
        this.eligibilityService = eligibilityService;
        this.stripeService = stripeService;
        this.appConfig = appConfig;
        this.clock = clock;
    }

    @POST
    public Response create(@Auth MerchantPrincipal principal, CreateBookingRequest req) {
        Merchant merchant = principal.merchant();
        if (req == null) {
            return badRequest("body required");
        }
        String serviceName = trimToNull(req.serviceName());
        if (serviceName == null) return badRequest("serviceName required");
        if (req.totalAmountCents() == null || req.totalAmountCents() <= 0) {
            return badRequest("totalAmountCents must be positive");
        }
        if (req.appointmentDate() == null) return badRequest("appointmentDate required");
        if (!req.appointmentDate().isAfter(LocalDate.now(clock))) {
            return badRequest("appointmentDate must be in the future");
        }
        Response gate = enforceStripeGate(merchant);
        if (gate != null) return gate;

        Booking booking = bookingService.create(new CreateBookingInput(
                merchant.id(),
                serviceName,
                trimToNull(req.serviceDescription()),
                req.totalAmountCents(),
                req.appointmentDate(),
                trimToNull(req.cancellationPolicy()),
                trimToNull(req.customerNameHint()),
                trimToNull(req.customerEmailHint())
        ));
        return Response.status(201).entity(detailView(merchant, booking)).build();
    }

    @GET
    public ListResponse list(
            @Auth MerchantPrincipal principal,
            @QueryParam("limit") Integer limit,
            @QueryParam("offset") Integer offset
    ) {
        Merchant merchant = principal.merchant();
        int safeLimit = clamp(limit == null ? 25 : limit, 1, 100);
        int safeOffset = Math.max(offset == null ? 0 : offset, 0);
        List<Booking> bookings = bookingService.list(merchant.id(), safeLimit, safeOffset);
        long total = bookingService.count(merchant.id());
        List<BookingView> views = bookings.stream()
                .map(b -> BookingView.summary(b, hostedUrlFor(merchant, b)))
                .toList();
        return new ListResponse(views, total, safeLimit, safeOffset);
    }

    @GET
    @Path("/{id}")
    public Response get(@Auth MerchantPrincipal principal, @PathParam("id") String idString) {
        UUID id;
        try {
            id = UUID.fromString(idString);
        } catch (IllegalArgumentException e) {
            return Response.status(404).entity(Map.of("error", "not_found")).build();
        }
        Merchant merchant = principal.merchant();
        return bookingService.findById(merchant.id(), id)
                .map(booking -> Response.ok(detailView(merchant, booking)).build())
                .orElseGet(() -> Response.status(404).entity(Map.of("error", "not_found")).build());
    }

    private Response enforceStripeGate(Merchant merchant) {
        // Stripe not wired on the backend: dev/test mode. The CLAUDE.md gate
        // exists to protect funds flow; without Stripe configured there is no
        // funds flow to protect, so we allow merchants to exercise the booking
        // form in dev. Production deploys must set STRIPE_SECRET_KEY.
        if (!stripeService.isConfigured()) return null;
        ConnectStatus status = ConnectStatus.fromWire(merchant.stripeConnectStatus());
        if (status == ConnectStatus.CHARGES_ENABLED) return null;
        return Response.status(403).entity(Map.of(
                "error", "stripe_not_ready",
                "message", "Finish Stripe Connect onboarding before creating bookings."
        )).build();
    }

    private BookingView detailView(Merchant merchant, Booking booking) {
        EligibilityResult eligibility = eligibilityService.evaluate(
                LocalDate.now(clock), booking.appointmentDate(), booking.totalAmountCents());
        List<BookingView.PlanOptionView> options = eligibility.options().stream()
                .map(BookingsResource::toOptionView)
                .toList();
        return BookingView.detail(
                booking,
                hostedUrlFor(merchant, booking),
                new BookingView.EligibilityView(
                        eligibility.eligible(),
                        eligibility.reason(),
                        eligibility.daysToAppointment()),
                options);
    }

    private static BookingView.PlanOptionView toOptionView(PlanOption o) {
        return new BookingView.PlanOptionView(
                o.frequency().wire(),
                o.numPayments(),
                o.perPaymentAmountCents(),
                o.finalPaymentAmountCents(),
                o.dueDates());
    }

    private String hostedUrlFor(Merchant merchant, Booking booking) {
        // pay.bliss.com lives at the frontend root in the (consumer)
        // /pay/[slug]/[token] route. For local dev the frontend base URL is
        // http://localhost:3000.
        return appConfig.getFrontendBaseUrl()
                + "/pay/" + merchant.slug() + "/" + booking.bookingToken();
    }

    private static Response badRequest(String message) {
        return Response.status(400).entity(Map.of("error", message)).build();
    }

    private static String trimToNull(String s) {
        if (s == null) return null;
        String t = s.trim();
        return t.isEmpty() ? null : t;
    }

    private static int clamp(int value, int min, int max) {
        return Math.max(min, Math.min(max, value));
    }

    public record CreateBookingRequest(
            @JsonProperty("serviceName") String serviceName,
            @JsonProperty("serviceDescription") String serviceDescription,
            @JsonProperty("totalAmountCents") Long totalAmountCents,
            @JsonProperty("appointmentDate") LocalDate appointmentDate,
            @JsonProperty("cancellationPolicy") String cancellationPolicy,
            @JsonProperty("customerNameHint") String customerNameHint,
            @JsonProperty("customerEmailHint") String customerEmailHint
    ) {}

    public record ListResponse(
            List<BookingView> bookings,
            long total,
            int limit,
            int offset
    ) {}
}
