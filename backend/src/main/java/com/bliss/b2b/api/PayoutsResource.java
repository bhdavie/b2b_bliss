package com.bliss.b2b.api;

import com.bliss.b2b.auth.MerchantPrincipal;
import com.bliss.b2b.domain.Booking;
import com.bliss.b2b.persistence.BookingDao;
import com.bliss.b2b.persistence.PayoutReleaseDao;
import io.dropwizard.auth.Auth;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import java.time.Instant;
import java.time.LocalDate;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Hold mode, for the property (spec section 9): money Bliss is holding and
 * when it will be sent, what has been sent, and Stripe's payouts to the bank.
 */
// Rooted at /api/v1/merchants like MerchantsResource, not /api/v1/merchants/me:
// a root at /me wins JAX-RS root matching for every /me path and 404s the
// routes it doesn't define (GET /merchants/me went down that way). Jersey merges
// resources sharing a root. Guarded by MerchantRoutesTest.
@Path("/api/v1/merchants")
@Produces(MediaType.APPLICATION_JSON)
public class PayoutsResource {

    private final PayoutReleaseDao releaseDao;
    private final BookingDao bookingDao;

    public PayoutsResource(PayoutReleaseDao releaseDao, BookingDao bookingDao) {
        this.releaseDao = releaseDao;
        this.bookingDao = bookingDao;
    }

    /**
     * One release. {@code status} is scheduled (held, sent on {@code releaseAt}),
     * released, reversed (pulled back by a cancellation) or canceled. A
     * {@code fee_debit} step is the Bliss fee a refund left the property to fund.
     */
    public record ReleaseView(UUID id, UUID bookingId, String stay, LocalDate checkIn, String step,
            Instant releaseAt, long amountMinor, long feeMinor, long reversedMinor, String currency, String status,
            Instant releasedAt, boolean failing) {
    }

    @GET
    @Path("/me/releases")
    public List<ReleaseView> releases(@Auth MerchantPrincipal principal) {
        Map<UUID, Booking> bookings = new HashMap<>();
        return releaseDao.forMerchant(principal.merchant().id()).stream().map(r -> {
            Booking b = bookings.computeIfAbsent(r.bookingId(), id -> bookingDao.findById(id).orElse(null));
            return new ReleaseView(r.id(), r.bookingId(), b == null ? null : b.serviceName(),
                    b == null ? null : b.appointmentDate(), r.step(), r.releaseAt(), r.amountMinor(), r.feeMinor(),
                    r.reversedMinor(), r.currency(), r.status(), r.releasedAt(), r.lastError() != null);
        }).toList();
    }

    @GET
    @Path("/me/payouts")
    public List<PayoutReleaseDao.Payout> payouts(@Auth MerchantPrincipal principal) {
        return releaseDao.payoutsForMerchant(principal.merchant().id());
    }
}
