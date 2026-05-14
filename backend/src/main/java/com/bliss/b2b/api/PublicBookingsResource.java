package com.bliss.b2b.api;

import com.bliss.b2b.domain.Booking;
import com.bliss.b2b.domain.Merchant;
import com.bliss.b2b.integration.StripePaymentsService;
import com.bliss.b2b.payments.EligibilityResult;
import com.bliss.b2b.payments.PlanEligibilityService;
import com.bliss.b2b.persistence.BookingDao;
import com.bliss.b2b.persistence.MerchantDao;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.time.Clock;
import java.time.LocalDate;
import java.util.Map;
import java.util.Optional;

@Path("/api/v1/public/bookings")
@Produces(MediaType.APPLICATION_JSON)
public class PublicBookingsResource {

    private final BookingDao bookingDao;
    private final MerchantDao merchantDao;
    private final PlanEligibilityService eligibilityService;
    private final StripePaymentsService stripeService;
    private final Clock clock;

    public PublicBookingsResource(
            BookingDao bookingDao,
            MerchantDao merchantDao,
            PlanEligibilityService eligibilityService,
            StripePaymentsService stripeService,
            Clock clock
    ) {
        this.bookingDao = bookingDao;
        this.merchantDao = merchantDao;
        this.eligibilityService = eligibilityService;
        this.stripeService = stripeService;
        this.clock = clock;
    }

    @GET
    @Path("/{slug}/{token}")
    public Response get(
            @PathParam("slug") String slug,
            @PathParam("token") String token
    ) {
        if (slug == null || slug.isBlank() || token == null || token.isBlank()) {
            return notFound();
        }
        Optional<Booking> maybe = bookingDao.findBySlugAndToken(slug, token);
        if (maybe.isEmpty()) return notFound();
        Booking booking = maybe.get();
        Merchant merchant = merchantDao.findById(booking.merchantId()).orElseThrow();
        EligibilityResult eligibility = eligibilityService.evaluate(
                LocalDate.now(clock), booking.appointmentDate(), booking.totalAmountCents());
        PublicBookingView view = PublicBookingView.build(
                merchant, booking, eligibility,
                stripeService.isConfigured(), stripeService.publishableKey());
        return Response.ok(view).build();
    }

    private static Response notFound() {
        return Response.status(404)
                .entity(Map.of("error", "not_found",
                        "message", "This link is no longer active. Contact the merchant for a new one."))
                .build();
    }
}
