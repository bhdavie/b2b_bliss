package com.bliss.b2b.service;

import com.bliss.b2b.domain.Booking;
import com.bliss.b2b.domain.Customer;
import com.bliss.b2b.domain.Merchant;
import com.bliss.b2b.domain.MewsConnection;
import com.bliss.b2b.domain.PaymentPlan;
import com.bliss.b2b.domain.PaymentPlanStatus;
import com.bliss.b2b.domain.PaymentScheduleEntry;
import com.bliss.b2b.domain.PmsType;
import com.bliss.b2b.integration.pms.MewsAdapter;
import com.bliss.b2b.integration.pms.MewsAdapterFactory;
import com.bliss.b2b.integration.pms.MewsPlatform;
import com.bliss.b2b.integration.pms.PmsAdapterException;
import com.bliss.b2b.integration.pms.PmsCardCollectionRequest;
import com.bliss.b2b.integration.pms.PmsChargeResult;
import com.bliss.b2b.integration.pms.PmsChargeStatus;
import com.bliss.b2b.integration.pms.PmsCustomer;
import com.bliss.b2b.integration.pms.PmsCustomerRef;
import com.bliss.b2b.integration.pms.PmsStoredCard;
import com.bliss.b2b.persistence.BookingDao;
import com.bliss.b2b.persistence.CustomerCardDao;
import com.bliss.b2b.persistence.CustomerDao;
import com.bliss.b2b.persistence.MerchantDao;
import com.bliss.b2b.persistence.MerchantMewsConnectionDao;
import com.bliss.b2b.persistence.PaymentPlanDao;
import com.bliss.b2b.persistence.PaymentScheduleDao;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import org.jdbi.v3.core.Jdbi;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Mews guest card-capture seam. Two steps, both keyed by booking token:
 *
 * <ol>
 *   <li>{@link #cardRequest} — ensure the Mews customer exists, open a card
 *       collection request, and hand the client the {@code requestId} +
 *       {@code dataBaseUrl} its Payments Checkout embed needs.
 *   <li>{@link #cardConfirm} — after the embed's client-side {@code onSuccess},
 *       verify server-side by reading {@code getStoredCards} for the plan's Mews
 *       customer and matching the vaulted card (the client's id alone is not
 *       trusted). On a match, reserve the stay in Mews, charge the first
 *       installment against that reservation, and activate the plan.
 * </ol>
 *
 * <p><b>Reservation order.</b> The room is held as an {@code Optional}
 * reservation (no Mews email), the first installment is charged with that
 * {@code ReservationId}, and only then is the reservation confirmed, which is
 * when Mews emails the guest. A declined card releases the hold with no email,
 * so a guest is never told they have a booking they do not. The reservation id
 * is stored the moment Mews returns it, so a retried confirm reuses the hold
 * rather than creating a second reservation.
 *
 * <p>Network calls to Mews are kept outside DB transactions.
 */
public class MewsCheckoutService {

    private static final Logger log = LoggerFactory.getLogger(MewsCheckoutService.class);

    private static final Duration REQUEST_TTL = Duration.ofDays(7);
    /**
     * How long Mews may keep an unconfirmed hold. The hold is created and then
     * confirmed or released within one request, so this only matters if the
     * process dies in between; a day leaves time to sort that out by hand.
     */
    private static final Duration HOLD_TTL = Duration.ofHours(24);

    private final Jdbi jdbi;
    private final MewsAdapterFactory mewsFactory;
    private final MewsStayService stayService;
    private final Clock clock;

    private final PlanNotificationService notificationService;

    public MewsCheckoutService(Jdbi jdbi, MewsAdapterFactory mewsFactory, MewsStayService stayService,
            PlanNotificationService notificationService, Clock clock) {
        this.jdbi = jdbi;
        this.mewsFactory = mewsFactory;
        this.stayService = stayService;
        this.notificationService = notificationService;
        this.clock = clock;
    }

    /**
     * Creates (or reuses) the Mews customer and opens a card collection request.
     * Returns the request id, the checkout {@code dataBaseUrl}, and the Mews
     * customer id.
     */
    public CardRequestResult cardRequest(String bookingToken) {
        Ctx ctx = jdbi.withHandle(h -> loadContext(h, bookingToken));
        // Resolved before any Mews call, so an unknown platform or a booking
        // with no room to reserve never leaves a half-made customer or card
        // request behind.
        String dataBaseUrl = appBaseUrl(ctx.connection.platformUrl());
        requireStay(ctx);

        MewsAdapter adapter = mewsFactory.adapterForConnection(ctx.connection);
        PmsCustomer mewsCustomer = adapter.findOrCreateCustomer(new PmsCustomerRef(
                ctx.customer.email(), ctx.customer.firstName(), ctx.customer.lastName()));
        Instant expiration = Instant.now(clock).plus(REQUEST_TTL);
        PmsCardCollectionRequest request = adapter.createCardCollectionRequest(
                mewsCustomer.id(), expiration, "Save a card for your booking");

        jdbi.useHandle(h -> {
            h.attach(CustomerDao.class).setMewsCustomerId(ctx.customer.id(), mewsCustomer.id());
            h.attach(PaymentPlanDao.class).setPendingMewsRequestId(ctx.plan.id(), request.requestId());
        });

        log.info("Mews card request {} for plan {} (customer {})",
                request.requestId(), ctx.plan.id(), mewsCustomer.id());
        return new CardRequestResult(
                request.requestId(), dataBaseUrl, mewsCustomer.id());
    }

    /**
     * Verifies the guest vaulted a card, charges the first installment, and
     * activates the plan. Charged or Pending both count as accepted. A hard
     * decline (failed/canceled state, or a transport/gateway error) leaves the
     * plan pending and throws.
     */
    public CardConfirmResult cardConfirm(String bookingToken, String clientPaymentMethodId) {
        Ctx ctx = jdbi.withHandle(h -> loadContext(h, bookingToken));
        // Fail closed before touching the card: charging needs the property's
        // own currency, and guessing one would label the amount wrongly.
        String currency = ctx.connection.currency();
        if (currency == null || currency.isBlank()) {
            throw new MewsCheckoutException("mews_currency_missing",
                    "This property's Mews connection has no currency set.");
        }

        String mewsCustomerId = jdbi.withHandle(h ->
                h.attach(CustomerDao.class).findMewsCustomerId(ctx.customer.id()).orElse(null));
        if (mewsCustomerId == null || mewsCustomerId.isBlank()) {
            throw new MewsCheckoutException("card_request_first",
                    "Open a card request before confirming.");
        }

        requireStay(ctx);

        MewsAdapter adapter = mewsFactory.adapterForConnection(ctx.connection);

        // Server-side verification: the card must actually exist in Mews for this
        // customer. The client's id is only used to disambiguate, never trusted.
        List<PmsStoredCard> cards = adapter.getStoredCards(mewsCustomerId);
        PmsStoredCard matched = matchCard(cards, clientPaymentMethodId);
        if (matched == null) {
            throw new MewsCheckoutException("card_not_found",
                    "No vaulted card was found for this customer.");
        }

        PaymentScheduleEntry first = jdbi.withHandle(h ->
                h.attach(PaymentScheduleDao.class).listForPlan(ctx.plan.id())).get(0);

        // 1. Hold the room. Reuses a hold a previous attempt already made.
        String reservationId = holdRoom(ctx, adapter, mewsCustomerId);

        // 2. Take the first installment against that reservation.
        PmsChargeResult result;
        try {
            result = adapter.chargeStoredCard(
                    mewsCustomerId, matched.id(), first.amountCents(), currency,
                    reservationId, "Bliss first installment");
        } catch (PmsAdapterException e) {
            // Transport / gateway error: the charge may or may not have landed,
            // so the hold stays and the plan stays pending. A retry reuses both.
            log.info("Mews first charge errored for plan {}: {}", ctx.plan.id(), e.getMessage());
            throw new MewsCheckoutException("charge_failed",
                    "Could not charge the card. " + e.getMessage());
        }

        PmsChargeStatus status = result.status();
        if (status == PmsChargeStatus.FAILED || status == PmsChargeStatus.CANCELED) {
            // Hard decline: release the hold quietly and leave the plan pending,
            // so the guest can try another card.
            releaseHold(ctx, adapter, reservationId, "Card declined at Bliss checkout");
            throw new MewsCheckoutException("charge_declined",
                    "The card was declined (state=" + result.rawState() + ").");
        }

        // 3. Confirm. This is when Mews sends the guest its confirmation email.
        // The money is taken, so a failure here must not undo the plan: the
        // hold stays Optional, and it is logged for the property to confirm.
        try {
            adapter.confirmReservation(reservationId, true);
        } catch (PmsAdapterException e) {
            log.error("Mews reservation {} for plan {} was charged but could not be confirmed: {}. "
                    + "Confirm it in Mews before {}.", reservationId, ctx.plan.id(), e.getMessage(),
                    Instant.now(clock).plus(HOLD_TTL));
        }

        // Accepted (Charged, or in-flight Pending/Verifying/Unknown). Persist the
        // card ids, record the first schedule row, and activate the plan.
        Instant now = Instant.now(clock);
        boolean charged = status == PmsChargeStatus.CHARGED;
        jdbi.useTransaction(h -> {
            h.attach(CustomerCardDao.class).setMewsCard(
                    ctx.plan.customerCardId(), matched.id(),
                    lastFour(matched.obfuscatedNumber()),
                    matched.expiryMonth() == null ? 12 : matched.expiryMonth(),
                    matched.expiryYear() == null ? 2099 : matched.expiryYear(),
                    matched.kind() == null ? "card" : matched.kind());
            PaymentScheduleDao scheduleDao = h.attach(PaymentScheduleDao.class);
            if (charged) {
                scheduleDao.markPaidMews(first.id(), result.paymentId(), now);
            } else {
                scheduleDao.recordMewsProcessing(first.id(), result.paymentId(),
                        "mews state=" + result.rawState(), now);
            }
            h.attach(PaymentPlanDao.class).updateStatus(
                    ctx.plan.id(), PaymentPlanStatus.ACTIVE.wire());
        });

        log.info("Mews card confirmed for plan {} (payment {}, state {})",
                ctx.plan.id(), result.paymentId(), result.rawState());

        // Plan just activated (pending_card -> active). Guest lifecycle emails
        // (idempotent, fire-and-forget). The receipt only fires when the first
        // charge settled; an in-flight charge gets its receipt from reconciliation.
        notificationService.onPlanActivated(ctx.plan.id());
        if (charged) {
            notificationService.onInstallmentPaid(ctx.plan.id(), first.id());
            notificationService.onPlanCompleted(ctx.plan.id());
        }

        return new CardConfirmResult(
                result.paymentId(),
                charged ? "paid" : "processing",
                result.rawState());
    }

    // --- helpers -----------------------------------------------------------

    /** A Mews plan can only be confirmed for a booking that says what to reserve. */
    private static void requireStay(Ctx ctx) {
        Booking b = ctx.booking;
        if (b.mewsResourceCategoryId() == null || b.mewsRateId() == null || b.adultCount() == null
                || !ctx.connection.isBookingSetupComplete()) {
            throw new MewsCheckoutException("stay_not_set",
                    "This booking has no room to reserve. Start again from the property's booking page.");
        }
    }

    /**
     * The booking's Mews reservation: the one already recorded, or a new
     * Optional hold. The id is stored before anything else happens. If another
     * request stored one first, this hold is released and theirs is used.
     */
    private String holdRoom(Ctx ctx, MewsAdapter adapter, String mewsCustomerId) {
        if (ctx.booking.mewsReservationId() != null) {
            return ctx.booking.mewsReservationId();
        }
        String reservationId;
        try {
            MewsStayService.StayTimes times = stayService.timesFor(ctx.merchant.slug(),
                    ctx.booking.appointmentDate(), ctx.booking.checkoutDate());
            reservationId = adapter.addOptionalReservation(
                    ctx.connection.serviceId(), mewsCustomerId,
                    ctx.booking.mewsResourceCategoryId(), ctx.booking.mewsRateId(),
                    ctx.connection.adultAgeCategoryId(), ctx.booking.adultCount(),
                    times.startUtc(), times.endUtc(), Instant.now(clock).plus(HOLD_TTL),
                    ctx.booking.bookingToken(), "Bliss payment plan " + ctx.plan.id());
        } catch (MewsStayService.MewsStayException e) {
            throw new MewsCheckoutException("mews_unreachable", e.getMessage());
        } catch (PmsAdapterException e) {
            // Most often the room sold since the quote (overbooking check).
            // Nothing has been charged.
            log.info("Mews hold refused for plan {}: {}", ctx.plan.id(), e.getMessage());
            throw new MewsCheckoutException("stay_unavailable",
                    "That room was just booked for your dates. Nothing was charged.");
        }
        int stored = jdbi.withHandle(h ->
                h.attach(BookingDao.class).setMewsReservationId(ctx.booking.id(), reservationId));
        if (stored == 1) {
            return reservationId;
        }
        releaseHold(ctx, adapter, reservationId, "Duplicate hold from a concurrent Bliss checkout");
        return jdbi.withHandle(h -> h.attach(BookingDao.class).findById(ctx.booking.id()))
                .map(Booking::mewsReservationId)
                .orElseThrow(() -> new MewsCheckoutException("not_found", "booking not found"));
    }

    /**
     * Cancels an unconfirmed hold without emailing the guest, and forgets it so
     * the next attempt holds afresh. A failed cancel is logged, not raised: the
     * hold still lapses at its release time.
     */
    private void releaseHold(Ctx ctx, MewsAdapter adapter, String reservationId, String notes) {
        try {
            adapter.cancelReservation(reservationId, false, notes);
        } catch (PmsAdapterException e) {
            log.warn("Could not release Mews hold {} for plan {}: {}", reservationId, ctx.plan.id(), e.getMessage());
        }
        jdbi.useHandle(h -> h.attach(BookingDao.class).clearMewsReservationId(ctx.booking.id(), reservationId));
    }

    private Ctx loadContext(org.jdbi.v3.core.Handle h, String bookingToken) {
        if (bookingToken == null || bookingToken.isBlank()) {
            throw new MewsCheckoutException("not_found", "booking not found");
        }
        Booking booking = h.attach(BookingDao.class).findByToken(bookingToken)
                .orElseThrow(() -> new MewsCheckoutException("not_found", "booking not found"));
        PaymentPlan plan = h.attach(PaymentPlanDao.class).findLatestForBooking(booking.id())
                .orElseThrow(() -> new MewsCheckoutException("not_found", "no plan for this booking"));
        if (plan.status() != PaymentPlanStatus.PENDING_CARD) {
            throw new MewsCheckoutException("plan_not_pending",
                    "plan is not awaiting a card (status=" + plan.status().wire() + ")");
        }
        Merchant merchant = h.attach(MerchantDao.class).findById(booking.merchantId())
                .orElseThrow(() -> new MewsCheckoutException("not_found", "merchant not found"));
        if (merchant.pmsType() != PmsType.MEWS) {
            throw new MewsCheckoutException("not_mews_rail", "this booking is not on the Mews rail");
        }
        MewsConnection connection = h.attach(MerchantMewsConnectionDao.class)
                .findByMerchant(merchant.id())
                .filter(MewsConnection::isValidated)
                .orElseThrow(() -> new MewsCheckoutException(
                        "mews_not_connected", "this property has no active Mews connection"));
        Customer customer = h.attach(CustomerDao.class).findById(plan.customerId())
                .orElseThrow(() -> new MewsCheckoutException("not_found", "customer not found"));
        return new Ctx(booking, plan, merchant, connection, customer);
    }

    /** Matches the client's id against the vaulted cards; single-card fallback. */
    private static PmsStoredCard matchCard(List<PmsStoredCard> cards, String clientPaymentMethodId) {
        if (cards == null || cards.isEmpty()) {
            return null;
        }
        if (clientPaymentMethodId != null && !clientPaymentMethodId.isBlank()) {
            return cards.stream()
                    .filter(c -> clientPaymentMethodId.equals(c.id()))
                    .findFirst()
                    .orElse(null);
        }
        return cards.size() == 1 ? cards.get(0) : null;
    }

    private static String lastFour(String obfuscated) {
        if (obfuscated == null || obfuscated.length() < 4) {
            return "0000";
        }
        return obfuscated.substring(obfuscated.length() - 4);
    }

    /** The checkout embed host for the connection's Mews environment; no guessing. */
    private static String appBaseUrl(String platformUrl) {
        return MewsPlatform.appBaseUrl(platformUrl).orElseThrow(() ->
                new MewsCheckoutException("mews_platform_unknown",
                        "This property's Mews connection points at an unrecognised platform."));
    }

    private record Ctx(
            Booking booking,
            PaymentPlan plan,
            Merchant merchant,
            MewsConnection connection,
            Customer customer) {
    }

    public record CardRequestResult(String requestId, String dataBaseUrl, String mewsCustomerId) {
    }

    public record CardConfirmResult(String paymentId, String status, String rawState) {
    }

    /** Recoverable checkout error surfaced with a stable code + message. */
    public static class MewsCheckoutException extends RuntimeException {
        private final String code;

        public MewsCheckoutException(String code, String message) {
            super(message);
            this.code = code;
        }

        public String code() {
            return code;
        }
    }
}
