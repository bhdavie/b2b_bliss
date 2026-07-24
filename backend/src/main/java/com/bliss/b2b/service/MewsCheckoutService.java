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
 *       trusted). On a match, vault the card ids, charge the first installment
 *       inline, and activate the plan.
 * </ol>
 *
 * <p>Network calls to Mews are kept outside DB transactions.
 */
public class MewsCheckoutService {

    private static final Logger log = LoggerFactory.getLogger(MewsCheckoutService.class);

    private static final Duration REQUEST_TTL = Duration.ofDays(7);
    private static final String DEFAULT_APP_BASE_URL = "https://app.mews-demo.com";
    private static final String DEFAULT_CURRENCY = "GBP";

    private final Jdbi jdbi;
    private final MewsAdapterFactory mewsFactory;
    private final Clock clock;

    private final PlanNotificationService notificationService;

    public MewsCheckoutService(Jdbi jdbi, MewsAdapterFactory mewsFactory,
            PlanNotificationService notificationService, Clock clock) {
        this.jdbi = jdbi;
        this.mewsFactory = mewsFactory;
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
                request.requestId(), appBaseUrl(ctx.connection.platformUrl()), mewsCustomer.id());
    }

    /**
     * Verifies the guest vaulted a card, charges the first installment, and
     * activates the plan. Charged or Pending both count as accepted. A hard
     * decline (failed/canceled state, or a transport/gateway error) leaves the
     * plan pending and throws.
     */
    public CardConfirmResult cardConfirm(String bookingToken, String clientPaymentMethodId) {
        Ctx ctx = jdbi.withHandle(h -> loadContext(h, bookingToken));

        String mewsCustomerId = jdbi.withHandle(h ->
                h.attach(CustomerDao.class).findMewsCustomerId(ctx.customer.id()).orElse(null));
        if (mewsCustomerId == null || mewsCustomerId.isBlank()) {
            throw new MewsCheckoutException("card_request_first",
                    "Open a card request before confirming.");
        }

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
        String currency = (ctx.connection.currency() == null || ctx.connection.currency().isBlank())
                ? DEFAULT_CURRENCY : ctx.connection.currency();

        PmsChargeResult result;
        try {
            result = adapter.chargeStoredCard(
                    mewsCustomerId, matched.id(), first.amountCents(), currency,
                    null, "Bliss first installment");
        } catch (PmsAdapterException e) {
            // Transport / gateway error: leave the plan pending.
            log.info("Mews first charge errored for plan {}: {}", ctx.plan.id(), e.getMessage());
            throw new MewsCheckoutException("charge_failed",
                    "Could not charge the card. " + e.getMessage());
        }

        PmsChargeStatus status = result.status();
        if (status == PmsChargeStatus.FAILED || status == PmsChargeStatus.CANCELED) {
            // Hard decline: leave the plan inactive.
            throw new MewsCheckoutException("charge_declined",
                    "The card was declined (state=" + result.rawState() + ").");
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

    /** api.mews-demo.com -> app.mews-demo.com, matching the checkout embed host. */
    private static String appBaseUrl(String platformUrl) {
        if (platformUrl == null || platformUrl.isBlank()) {
            return DEFAULT_APP_BASE_URL;
        }
        return platformUrl.replace("://api.", "://app.");
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
