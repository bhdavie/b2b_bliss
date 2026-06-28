package com.bliss.b2b.service;

import com.bliss.b2b.domain.Booking;
import com.bliss.b2b.domain.Customer;
import com.bliss.b2b.domain.CustomerCard;
import com.bliss.b2b.domain.Merchant;
import com.bliss.b2b.domain.PaymentPlan;
import com.bliss.b2b.domain.PaymentPlanStatus;
import com.bliss.b2b.domain.PaymentScheduleEntry;
import com.bliss.b2b.domain.PaymentScheduleStatus;
import com.bliss.b2b.domain.ScheduleKind;
import com.bliss.b2b.integration.StripePaymentsService;
import com.bliss.b2b.integration.StripePaymentsService.CardSummary;
import com.bliss.b2b.persistence.BookingDao;
import com.bliss.b2b.persistence.CustomerCardDao;
import com.bliss.b2b.persistence.CustomerDao;
import com.bliss.b2b.persistence.MerchantDao;
import com.bliss.b2b.persistence.PaymentPlanDao;
import com.bliss.b2b.persistence.PaymentScheduleDao;
import com.stripe.exception.CardException;
import com.stripe.exception.StripeException;
import com.stripe.model.PaymentIntent;
import com.stripe.model.PaymentMethod;
import com.stripe.model.SetupIntent;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.jdbi.v3.core.Jdbi;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Backs the customer plan portal at {@code /plan/{bookingToken}}. Read path
 * bundles every row the portal renders; write paths advance the schedule
 * (pay early) or vault a replacement card. All Stripe work sits inside a
 * single {@code !stripeService.isConfigured()} branch per method — demo
 * mode persists the same shape with synthesized {@code *_demo_*} ids.
 */
public class PlanPortalService {

    private static final Logger log = LoggerFactory.getLogger(PlanPortalService.class);

    private final Jdbi jdbi;
    private final StripePaymentsService stripeService;
    private final Clock clock;

    public PlanPortalService(Jdbi jdbi, StripePaymentsService stripeService, Clock clock) {
        this.jdbi = jdbi;
        this.stripeService = stripeService;
        this.clock = clock;
    }

    public Optional<PortalSnapshot> getPortal(String bookingToken) {
        return jdbi.withHandle(handle -> {
            Booking booking = handle.attach(BookingDao.class).findByToken(bookingToken).orElse(null);
            if (booking == null) return Optional.<PortalSnapshot>empty();
            Merchant merchant = handle.attach(MerchantDao.class).findById(booking.merchantId()).orElse(null);
            if (merchant == null) return Optional.<PortalSnapshot>empty();
            PaymentPlan plan = handle.attach(PaymentPlanDao.class).findActiveForBooking(booking.id()).orElse(null);
            if (plan == null) return Optional.<PortalSnapshot>empty();
            List<PaymentScheduleEntry> schedule = handle.attach(PaymentScheduleDao.class).listForPlan(plan.id());
            Customer customer = handle.attach(CustomerDao.class).findById(plan.customerId()).orElse(null);
            CustomerCard card = handle.attach(CustomerCardDao.class)
                    .findDefaultForCustomer(plan.customerId()).orElse(null);
            return Optional.of(new PortalSnapshot(
                    merchant, booking, plan, schedule, customer, card,
                    plan.processingFeeCents()));
        });
    }

    /**
     * Customer-initiated pay-early on the next {@code scheduled} installment.
     * Reuses the same off-session charge path the deposit went through; the
     * single demo branch at the top mirrors that path without a Stripe call.
     */
    public PayResult payNextInstallment(String bookingToken) {
        if (!stripeService.isConfigured()) {
            return payNextInstallmentDemo(bookingToken);
        }
        return jdbi.inTransaction(handle -> {
            Lookup look = resolveOrThrow(handle, bookingToken);
            if (look.plan.status() != PaymentPlanStatus.ACTIVE) {
                throw new PortalException(PortalErrorCode.PLAN_NOT_ACTIVE,
                        "plan is not active (status=" + look.plan.status().wire() + ")");
            }
            PaymentScheduleDao scheduleDao = handle.attach(PaymentScheduleDao.class);
            PaymentScheduleEntry next = scheduleDao.findNextScheduled(look.plan.id()).orElseThrow(
                    () -> new PortalException(PortalErrorCode.NO_NEXT_INSTALLMENT,
                            "no scheduled installment remaining"));

            CustomerCard card = handle.attach(CustomerCardDao.class)
                    .findDefaultForCustomer(look.plan.customerId())
                    .orElseThrow(() -> new PortalException(PortalErrorCode.NO_CARD_ON_FILE,
                            "no card on file for this plan"));

            PaymentIntent intent;
            try {
                intent = stripeService.firePaymentOffSession(
                        next.amountCents(),
                        look.customer.stripeCustomerId(),
                        card.stripePaymentMethodId(),
                        next.id().toString(),
                        Map.of(
                                "bliss_payment_schedule_id", next.id().toString(),
                                "bliss_payment_plan_id", look.plan.id().toString(),
                                "bliss_booking_id", look.booking.id().toString(),
                                "bliss_kind", next.kind().wire(),
                                "bliss_source", "portal_pay_early"));
            } catch (CardException e) {
                throw new PortalException(PortalErrorCode.CARD_DECLINED,
                        e.getStripeError() != null && e.getStripeError().getMessage() != null
                                ? e.getStripeError().getMessage()
                                : "your card was declined");
            } catch (StripeException e) {
                log.warn("Stripe error in pay-early: {}", e.getMessage());
                throw new PortalException(PortalErrorCode.STRIPE_ERROR, "payment processor error");
            }

            String wireStatus = intent.getStatus() == null ? "" : intent.getStatus();
            PaymentScheduleStatus newStatus = PlanCreationService.mapIntentToStatus(wireStatus);
            scheduleDao.recordAttempt(look.plan.id(), next.sequence(), newStatus.wire(),
                    intent.getId(), Instant.now(clock));
            if (newStatus == PaymentScheduleStatus.FAILED) {
                throw new PortalException(PortalErrorCode.CARD_DECLINED,
                        "payment was not completed (status=" + wireStatus + ")");
            }
            if (newStatus == PaymentScheduleStatus.SCHEDULED) {
                throw new PortalException(PortalErrorCode.CARD_REQUIRES_ACTION,
                        "card requires authentication; please use a different card");
            }
            maybeCompletePlan(handle, look.plan, next);
            return new PayResult(intent.getId(), wireStatus);
        });
    }

    private PayResult payNextInstallmentDemo(String bookingToken) {
        return jdbi.inTransaction(handle -> {
            Lookup look = resolveOrThrow(handle, bookingToken);
            if (look.plan.status() != PaymentPlanStatus.ACTIVE) {
                throw new PortalException(PortalErrorCode.PLAN_NOT_ACTIVE,
                        "plan is not active (status=" + look.plan.status().wire() + ")");
            }
            PaymentScheduleDao scheduleDao = handle.attach(PaymentScheduleDao.class);
            PaymentScheduleEntry next = scheduleDao.findNextScheduled(look.plan.id()).orElseThrow(
                    () -> new PortalException(PortalErrorCode.NO_NEXT_INSTALLMENT,
                            "no scheduled installment remaining"));
            String demoIntentId = StripeIds.intentIdFor(next.id());
            scheduleDao.markPaidNow(next.id(), demoIntentId, Instant.now(clock));
            maybeCompletePlan(handle, look.plan, next);
            return new PayResult(demoIntentId, "succeeded");
        });
    }

    /**
     * Attach a freshly-vaulted PaymentMethod to the customer and mark it as
     * the new default. Existing default is flagged non-default first so the
     * portal's card-on-file lookup picks the new one. Demo mode skips the
     * Stripe attach and just inserts the row.
     */
    public ReplaceCardResult replacePaymentMethod(
            String bookingToken, String newPaymentMethodId, PlanCreationService.DemoCard demoCard) {
        if (!stripeService.isConfigured()) {
            return replacePaymentMethodDemo(bookingToken, newPaymentMethodId, demoCard);
        }
        return jdbi.inTransaction(handle -> {
            Lookup look = resolveOrThrow(handle, bookingToken);
            if (newPaymentMethodId == null || newPaymentMethodId.isBlank()) {
                throw new PortalException(PortalErrorCode.INVALID_INPUT, "paymentMethodId required");
            }
            String stripeCustomerId = look.customer.stripeCustomerId();
            if (stripeCustomerId == null || stripeCustomerId.isBlank()) {
                throw new PortalException(PortalErrorCode.INVALID_INPUT,
                        "customer has no stripe customer id");
            }
            PaymentMethod pm;
            try {
                pm = stripeService.attachPaymentMethod(newPaymentMethodId, stripeCustomerId);
            } catch (StripeException e) {
                log.warn("Stripe error attaching new PM in portal: {}", e.getMessage());
                throw new PortalException(PortalErrorCode.STRIPE_ERROR, "payment processor error");
            }
            CardSummary summary = StripePaymentsService.summarize(pm);
            CustomerCardDao cardDao = handle.attach(CustomerCardDao.class);
            cardDao.markAllNonDefaultForCustomer(look.customer.id());
            cardDao.insert(look.customer.id(), pm.getId(),
                    summary.lastFour(), summary.expMonth(), summary.expYear(),
                    summary.brand(), true);
            CustomerCard stored = cardDao.findByPaymentMethodId(pm.getId()).orElseThrow();
            return new ReplaceCardResult(
                    stored.brand(), stored.lastFour(), stored.expMonth(), stored.expYear());
        });
    }

    private ReplaceCardResult replacePaymentMethodDemo(
            String bookingToken, String newPaymentMethodId, PlanCreationService.DemoCard demoCard) {
        return jdbi.inTransaction(handle -> {
            Lookup look = resolveOrThrow(handle, bookingToken);
            String pmId = newPaymentMethodId != null && newPaymentMethodId.startsWith("pm_demo_")
                    ? newPaymentMethodId
                    : StripeIds.paymentMethodId();
            String lastFour = demoCard != null && demoCard.lastFour() != null
                    ? demoCard.lastFour() : "4242";
            int expMonth = demoCard != null && demoCard.expMonth() != null
                    ? demoCard.expMonth() : 12;
            int expYear = demoCard != null && demoCard.expYear() != null
                    ? demoCard.expYear() : 2030;
            String brand = demoCard != null && demoCard.brand() != null
                    ? demoCard.brand() : "visa";

            CustomerCardDao cardDao = handle.attach(CustomerCardDao.class);
            cardDao.markAllNonDefaultForCustomer(look.customer.id());
            cardDao.insert(look.customer.id(), pmId, lastFour, expMonth, expYear, brand, true);
            return new ReplaceCardResult(brand, lastFour, expMonth, expYear);
        });
    }

    /**
     * Create a SetupIntent for the plan's customer so the frontend's
     * Stripe Elements can confirm a new card. Demo mode rejects this call —
     * the frontend will short-circuit and never hit it, but the guard is
     * here so the API doesn't silently 500 if it does.
     */
    public String createSetupIntentForCustomer(String bookingToken) {
        if (!stripeService.isConfigured()) {
            throw new PortalException(PortalErrorCode.SETUP_INTENT_NOT_AVAILABLE_IN_DEMO,
                    "SetupIntent flow is not used in demo mode");
        }
        return jdbi.withHandle(handle -> {
            Lookup look = resolveOrThrow(handle, bookingToken);
            String stripeCustomerId = look.customer.stripeCustomerId();
            if (stripeCustomerId == null || stripeCustomerId.isBlank()) {
                throw new PortalException(PortalErrorCode.INVALID_INPUT,
                        "customer has no stripe customer id");
            }
            try {
                SetupIntent si = stripeService.createSetupIntent(stripeCustomerId);
                return si.getClientSecret();
            } catch (StripeException e) {
                log.warn("Stripe error creating SetupIntent: {}", e.getMessage());
                throw new PortalException(PortalErrorCode.STRIPE_ERROR, "payment processor error");
            }
        });
    }

    private void maybeCompletePlan(
            org.jdbi.v3.core.Handle handle,
            PaymentPlan plan,
            PaymentScheduleEntry justPaid) {
        if (justPaid.kind() != ScheduleKind.INSTALLMENT) return;
        PaymentScheduleDao scheduleDao = handle.attach(PaymentScheduleDao.class);
        boolean anyRemaining = scheduleDao.findNextScheduled(plan.id()).isPresent();
        if (anyRemaining) return;
        if (!PaymentPlanStateMachine.isAllowed(plan.status(), PaymentPlanStatus.COMPLETED)) return;
        handle.attach(PaymentPlanDao.class).updateStatus(plan.id(), PaymentPlanStatus.COMPLETED.wire());
    }

    private Lookup resolveOrThrow(org.jdbi.v3.core.Handle handle, String bookingToken) {
        Booking booking = handle.attach(BookingDao.class).findByToken(bookingToken)
                .orElseThrow(() -> new PortalException(PortalErrorCode.NOT_FOUND, "plan not found"));
        PaymentPlan plan = handle.attach(PaymentPlanDao.class).findActiveForBooking(booking.id())
                .orElseThrow(() -> new PortalException(PortalErrorCode.NOT_FOUND, "plan not found"));
        Customer customer = handle.attach(CustomerDao.class).findById(plan.customerId())
                .orElseThrow(() -> new PortalException(PortalErrorCode.NOT_FOUND, "plan not found"));
        return new Lookup(booking, plan, customer);
    }

    private record Lookup(Booking booking, PaymentPlan plan, Customer customer) {}

    public record PortalSnapshot(
            Merchant merchant,
            Booking booking,
            PaymentPlan plan,
            List<PaymentScheduleEntry> schedule,
            Customer customer,
            CustomerCard card,
            long processingFeeCents
    ) {}

    public record PayResult(String paymentIntentId, String status) {}

    public record ReplaceCardResult(String brand, String lastFour, int expMonth, int expYear) {}

    public enum PortalErrorCode {
        NOT_FOUND,
        PLAN_NOT_ACTIVE,
        NO_NEXT_INSTALLMENT,
        NO_CARD_ON_FILE,
        CARD_DECLINED,
        CARD_REQUIRES_ACTION,
        STRIPE_ERROR,
        INVALID_INPUT,
        SETUP_INTENT_NOT_AVAILABLE_IN_DEMO,
    }

    public static class PortalException extends RuntimeException {
        private final PortalErrorCode code;

        public PortalException(PortalErrorCode code, String message) {
            super(message);
            this.code = code;
        }

        public PortalErrorCode code() {
            return code;
        }
    }

}
