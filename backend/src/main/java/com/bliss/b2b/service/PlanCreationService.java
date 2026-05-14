package com.bliss.b2b.service;

import com.bliss.b2b.domain.Booking;
import com.bliss.b2b.domain.ConnectStatus;
import com.bliss.b2b.domain.Customer;
import com.bliss.b2b.domain.CustomerCard;
import com.bliss.b2b.domain.Merchant;
import com.bliss.b2b.domain.PaymentPlan;
import com.bliss.b2b.domain.PaymentScheduleEntry;
import com.bliss.b2b.domain.PaymentScheduleStatus;
import com.bliss.b2b.integration.EmailService;
import com.bliss.b2b.integration.EmailTemplates;
import com.bliss.b2b.integration.StripePaymentsService;
import com.bliss.b2b.integration.StripePaymentsService.CardSummary;
import com.bliss.b2b.payments.EligibilityResult;
import com.bliss.b2b.payments.MerchantPlanRules;
import com.bliss.b2b.payments.PlanEligibilityService;
import com.bliss.b2b.payments.PlanFrequency;
import com.bliss.b2b.payments.PlanOption;
import com.bliss.b2b.persistence.BookingDao;
import com.bliss.b2b.persistence.CustomerCardDao;
import com.bliss.b2b.persistence.CustomerDao;
import com.bliss.b2b.persistence.MerchantDao;
import com.bliss.b2b.persistence.MerchantPlanRulesDao;
import com.bliss.b2b.persistence.PaymentPlanDao;
import com.bliss.b2b.persistence.PaymentScheduleDao;
import com.bliss.b2b.service.PlanCreationException.Reason;
import com.stripe.exception.CardException;
import com.stripe.exception.StripeException;
import com.stripe.model.PaymentIntent;
import com.stripe.model.PaymentMethod;
import java.time.Clock;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.jdbi.v3.core.Jdbi;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Orchestrates accept-a-plan: validate eligibility server-side, get-or-create
 * the customer, attach the Stripe PaymentMethod, write the plan + schedule,
 * fire the first PaymentIntent off-session, send notifications. All DB work
 * happens in a single JDBI transaction; a Stripe decline or any DB failure
 * rolls back the plan so the booking returns to {@code sent} for retry.
 */
public class PlanCreationService {

    private static final Logger log = LoggerFactory.getLogger(PlanCreationService.class);
    private static final Logger webhookLog = LoggerFactory.getLogger("bliss.merchant.webhook");

    private final Jdbi jdbi;
    private final PlanEligibilityService eligibilityService;
    private final StripePaymentsService stripeService;
    private final EmailService emailService;
    private final Clock clock;

    public PlanCreationService(
            Jdbi jdbi,
            PlanEligibilityService eligibilityService,
            StripePaymentsService stripeService,
            EmailService emailService,
            Clock clock
    ) {
        this.jdbi = jdbi;
        this.eligibilityService = eligibilityService;
        this.stripeService = stripeService;
        this.emailService = emailService;
        this.clock = clock;
    }

    public PlanCreationResult createPlan(CreatePlanInput input) {
        if (!stripeService.isConfigured()) {
            throw new PlanCreationException(Reason.STRIPE_NOT_CONFIGURED,
                    "Stripe is not configured on the backend.");
        }
        if (input.paymentMethodId() == null || input.paymentMethodId().isBlank()) {
            throw new PlanCreationException(Reason.INVALID_INPUT, "paymentMethodId required");
        }
        if (input.customerEmail() == null || input.customerEmail().isBlank()) {
            throw new PlanCreationException(Reason.INVALID_INPUT, "customerEmail required");
        }
        if (input.frequency() == null) {
            throw new PlanCreationException(Reason.INVALID_INPUT, "frequency required");
        }

        Outcome outcome = jdbi.inTransaction(handle -> {
            BookingDao bookingDao = handle.attach(BookingDao.class);
            MerchantDao merchantDao = handle.attach(MerchantDao.class);
            CustomerDao customerDao = handle.attach(CustomerDao.class);
            CustomerCardDao cardDao = handle.attach(CustomerCardDao.class);
            PaymentPlanDao planDao = handle.attach(PaymentPlanDao.class);
            PaymentScheduleDao scheduleDao = handle.attach(PaymentScheduleDao.class);

            Booking booking = bookingDao.findBySlugAndToken(input.merchantSlug(), input.bookingToken())
                    .orElseThrow(() -> new PlanCreationException(
                            Reason.BOOKING_NOT_FOUND, "booking not found"));
            if (booking.status() != com.bliss.b2b.domain.BookingStatus.SENT) {
                throw new PlanCreationException(Reason.BOOKING_NOT_OPEN,
                        "booking is not open for plan acceptance (status=" + booking.status().wire() + ")");
            }
            Merchant merchant = merchantDao.findById(booking.merchantId()).orElseThrow();
            ConnectStatus connectStatus = ConnectStatus.fromWire(merchant.stripeConnectStatus());
            if (connectStatus != ConnectStatus.CHARGES_ENABLED) {
                throw new PlanCreationException(Reason.MERCHANT_NOT_READY,
                        "merchant has not completed Stripe onboarding");
            }

            MerchantPlanRulesDao rulesDao = handle.attach(MerchantPlanRulesDao.class);
            MerchantPlanRules rules = rulesDao.findByMerchantId(merchant.id())
                    .orElse(MerchantPlanRules.DEFAULTS);

            LocalDate today = LocalDate.now(clock);
            EligibilityResult eligibility = eligibilityService.evaluate(
                    today, booking.appointmentDate(), booking.totalAmountCents(), rules);
            if (!eligibility.eligible()) {
                throw new PlanCreationException(Reason.ELIGIBILITY_FAILED,
                        "appointment is too close for a plan");
            }
            PlanOption option = eligibility.options().stream()
                    .filter(o -> o.frequency() == input.frequency())
                    .findFirst()
                    .orElseThrow(() -> new PlanCreationException(
                            Reason.ELIGIBILITY_FAILED,
                            input.frequency().wire() + " is not an eligible frequency for this booking"));

            String email = input.customerEmail().trim().toLowerCase();
            Customer customer = customerDao.findByEmail(email).orElseGet(() -> {
                customerDao.insert(email, trimToNull(input.customerFirstName()),
                        trimToNull(input.customerLastName()));
                return customerDao.findByEmail(email).orElseThrow();
            });

            String stripeCustomerId = customer.stripeCustomerId();
            if (stripeCustomerId == null || stripeCustomerId.isBlank()) {
                try {
                    stripeCustomerId = stripeService.createStripeCustomer(customer);
                } catch (StripeException e) {
                    throw stripeFailure(e);
                }
                customerDao.setStripeCustomerId(customer.id(), stripeCustomerId);
                customer = customerDao.findById(customer.id()).orElseThrow();
            }

            PaymentMethod pm;
            try {
                pm = stripeService.attachPaymentMethod(input.paymentMethodId(), stripeCustomerId);
            } catch (CardException e) {
                throw declined(e);
            } catch (StripeException e) {
                throw stripeFailure(e);
            }
            CardSummary card = StripePaymentsService.summarize(pm);
            cardDao.insert(customer.id(), pm.getId(),
                    card.lastFour(), card.expMonth(), card.expYear(), card.brand(), true);
            CustomerCard storedCard = cardDao.findByPaymentMethodId(pm.getId()).orElseThrow();

            int n = option.numPayments();
            LocalDate startDate = option.dueDates().get(0);
            LocalDate endDate = option.dueDates().get(n - 1);

            planDao.insert(
                    booking.id(),
                    customer.id(),
                    storedCard.id(),
                    booking.totalAmountCents(),
                    n,
                    option.frequency().wire(),
                    startDate,
                    endDate);
            PaymentPlan plan = planDao.findActiveForBooking(booking.id())
                    .orElseThrow(() -> new IllegalStateException("plan insert disappeared"));

            for (int i = 0; i < n; i++) {
                long amount = (i == n - 1)
                        ? option.finalPaymentAmountCents()
                        : option.perPaymentAmountCents();
                scheduleDao.insert(plan.id(), i + 1, option.dueDates().get(i), amount,
                        PaymentScheduleStatus.SCHEDULED.wire());
            }

            int markedAccepted = bookingDao.markAccepted(booking.id(), customer.id());
            if (markedAccepted != 1) {
                // Another concurrent request flipped the status. Surface as
                // BOOKING_NOT_OPEN so the consumer is told to refresh.
                throw new PlanCreationException(Reason.BOOKING_NOT_OPEN,
                        "booking was just accepted by another session");
            }

            List<PaymentScheduleEntry> schedule = scheduleDao.listForPlan(plan.id());
            PaymentScheduleEntry first = schedule.get(0);

            PaymentIntent firstIntent;
            try {
                firstIntent = stripeService.firePaymentOffSession(
                        first.amountCents(),
                        stripeCustomerId,
                        pm.getId(),
                        first.id().toString(),
                        Map.of(
                                "bliss_payment_schedule_id", first.id().toString(),
                                "bliss_payment_plan_id", plan.id().toString(),
                                "bliss_booking_id", booking.id().toString()));
            } catch (CardException e) {
                throw declined(e);
            } catch (StripeException e) {
                throw stripeFailure(e);
            }

            String paymentStatus = firstIntent.getStatus() == null ? "" : firstIntent.getStatus();
            PaymentScheduleStatus newStatus = mapIntentToStatus(paymentStatus);
            scheduleDao.recordAttempt(plan.id(), 1, newStatus.wire(),
                    firstIntent.getId(), java.time.Instant.now(clock));
            if (newStatus == PaymentScheduleStatus.FAILED) {
                throw new PlanCreationException(Reason.CARD_DECLINED,
                        "first payment was not completed (status=" + paymentStatus + ")");
            }
            if (newStatus == PaymentScheduleStatus.SCHEDULED) {
                // requires_action / requires_confirmation etc. Caller must
                // complete the SCA challenge. v1 US-only flow rarely hits this.
                throw new PlanCreationException(Reason.CARD_REQUIRES_ACTION,
                        "card requires authentication; please use a different card");
            }

            return new Outcome(merchant, customer, booking, plan, schedule, firstIntent.getId(), paymentStatus);
        });

        // Notifications and the merchant webhook fire post-commit so a flaky
        // mailer doesn't roll back the plan. Best-effort with logging.
        emitPlanStartedWebhook(outcome);
        sendNotifications(outcome);

        return new PlanCreationResult(
                outcome.plan().id(),
                outcome.booking(),
                outcome.plan(),
                outcome.schedule(),
                outcome.firstChargeIntentId(),
                outcome.firstChargeStatus());
    }

    private void sendNotifications(Outcome o) {
        try {
            emailService.send(EmailTemplates.customerPlanConfirmation(
                    o.customer().email(), o.merchant(), o.booking(), o.plan(), o.schedule()));
        } catch (Exception e) {
            log.warn("Failed to send plan confirmation to {}: {}", o.customer().email(), e.getMessage());
        }
        try {
            emailService.send(EmailTemplates.merchantBookingAccepted(
                    o.merchant(), o.booking(), o.customer(), o.plan()));
        } catch (Exception e) {
            log.warn("Failed to send booking accepted to merchant {}: {}", o.merchant().email(), e.getMessage());
        }
    }

    private void emitPlanStartedWebhook(Outcome o) {
        // Phase 7 builds the outbound webhook delivery service with HMAC
        // signing and retries. Until then, log the payload so the eventual
        // delivery layer can replay from logs if needed.
        webhookLog.info(
                "plan.started merchant={} booking={} plan={} customer={} frequency={} numPayments={} firstIntent={}",
                o.merchant().id(), o.booking().id(), o.plan().id(),
                o.customer().id(), o.plan().frequency().wire(), o.plan().numPayments(),
                o.firstChargeIntentId());
    }

    private static PaymentScheduleStatus mapIntentToStatus(String paymentIntentStatus) {
        return switch (paymentIntentStatus) {
            case "succeeded" -> PaymentScheduleStatus.PAID;
            case "processing" -> PaymentScheduleStatus.PROCESSING;
            case "requires_action", "requires_confirmation", "requires_payment_method" ->
                    PaymentScheduleStatus.SCHEDULED;
            case "canceled" -> PaymentScheduleStatus.CANCELED;
            default -> PaymentScheduleStatus.FAILED;
        };
    }

    private static PlanCreationException declined(CardException e) {
        return new PlanCreationException(Reason.CARD_DECLINED,
                e.getStripeError() != null && e.getStripeError().getMessage() != null
                        ? e.getStripeError().getMessage()
                        : "your card was declined",
                e);
    }

    private static PlanCreationException stripeFailure(StripeException e) {
        return new PlanCreationException(Reason.STRIPE_ERROR,
                "payment processor error: " + e.getMessage(), e);
    }

    private static String trimToNull(String s) {
        if (s == null) return null;
        String t = s.trim();
        return t.isEmpty() ? null : t;
    }

    public record CreatePlanInput(
            String merchantSlug,
            String bookingToken,
            String customerEmail,
            String customerFirstName,
            String customerLastName,
            String paymentMethodId,
            PlanFrequency frequency
    ) {}

    public record PlanCreationResult(
            UUID planId,
            Booking booking,
            PaymentPlan plan,
            List<PaymentScheduleEntry> schedule,
            String firstChargeIntentId,
            String firstChargeStatus
    ) {}

    private record Outcome(
            Merchant merchant,
            Customer customer,
            Booking booking,
            PaymentPlan plan,
            List<PaymentScheduleEntry> schedule,
            String firstChargeIntentId,
            String firstChargeStatus
    ) {}
}
