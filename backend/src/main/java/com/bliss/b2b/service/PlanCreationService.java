package com.bliss.b2b.service;

import com.bliss.b2b.domain.Booking;
import com.bliss.b2b.domain.BookingSource;
import com.bliss.b2b.domain.ConnectStatus;
import com.bliss.b2b.domain.Customer;
import com.bliss.b2b.domain.CustomerCard;
import com.bliss.b2b.domain.Merchant;
import com.bliss.b2b.domain.PaymentPlan;
import com.bliss.b2b.domain.PaymentScheduleEntry;
import com.bliss.b2b.domain.PaymentScheduleStatus;
import com.bliss.b2b.domain.ScheduleKind;
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
import java.security.SecureRandom;
import java.time.Clock;
import java.time.LocalDate;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.jdbi.v3.core.Jdbi;
import org.jdbi.v3.core.Handle;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Orchestrates accept-a-plan. Two entry points, one shared core:
 *
 * <ul>
 *   <li>{@link #createPlan} — merchant-initiated path. The merchant already
 *       created a booking row from their dashboard; the customer is
 *       accepting via {@code /pay/{slug}/{token}}.
 *   <li>{@link #createBookingAndPlan} — customer-initiated path (Phase 13).
 *       The customer landed at {@code /checkout/{slug}} from the merchant's
 *       own checkout page with cart details in the URL. We mint a booking
 *       row inline before running the same accept-a-plan logic.
 * </ul>
 *
 * <p>Both paths converge on {@link #acceptForBooking}, which does the heavy
 * lifting: get-or-create the Stripe customer, attach the PaymentMethod,
 * write the PaymentPlan + PaymentSchedule rows, mark the booking accepted,
 * and fire the first PaymentIntent. The whole thing runs inside a JDBI
 * transaction; a Stripe decline or any DB failure rolls back so a customer
 * never sees a half-created plan.
 */
public class PlanCreationService {

    private static final Logger log = LoggerFactory.getLogger(PlanCreationService.class);
    private static final Logger webhookLog = LoggerFactory.getLogger("bliss.merchant.webhook");
    private static final SecureRandom RNG = new SecureRandom();
    private static final int TOKEN_INSERT_RETRIES = 5;
    private static final int TOKEN_BYTES = 12;

    /**
     * Bliss fee: 5% of the plan's full total (the customer-facing booking total,
     * already inclusive of taxes and fees). Layered onto the customer schedule at
     * persistence time; eligibility math stays fee-free. The resolved fee is
     * stored per-plan in {@code payment_plans.processing_fee_cents} so historical
     * plans keep whatever fee they were created and charged under. Mirrors
     * {@code BLISS_FEE_RATE} / {@code calcInstallmentPlan} in
     * {@code frontend/lib/blissFee.ts}; the two must stay in sync.
     */
    public static final double BLISS_FEE_RATE = 0.05;

    /** Legacy flat fee, retained only for the V13 backfill of pre-migration plans. */
    public static final long LEGACY_FLAT_FEE_CENTS = 2000L;

    /** 5% of the full plan total, rounded to whole cents. */
    public static long feeFor(long totalCents) {
        return Math.round(totalCents * BLISS_FEE_RATE);
    }

    /**
     * Layer the Bliss fee onto the customer schedule. With a deposit the fee
     * rides the deposit and the installments stay clean ((discountedTotal -
     * deposit)/N). With no deposit the fee-inclusive total is split evenly across
     * the installments (the final one absorbs the rounding remainder), matching
     * {@code calcInstallmentPlan} on the frontend and the /pay estimate. Either
     * way SUM(schedule) == discountedTotal + feeCents.
     */
    private static void buildSchedule(
            PaymentScheduleDao scheduleDao,
            UUID planId,
            LocalDate today,
            boolean hasDeposit,
            long depositAmount,
            long feeCents,
            long discountedTotal,
            int installmentCount,
            PlanOption option) {
        int seq = 1;
        if (hasDeposit) {
            scheduleDao.insert(planId, seq, today, depositAmount + feeCents,
                    PaymentScheduleStatus.SCHEDULED.wire(), ScheduleKind.DEPOSIT.wire());
            seq++;
            for (int i = 0; i < installmentCount; i++) {
                long amount = (i == installmentCount - 1)
                        ? option.finalPaymentAmountCents()
                        : option.perPaymentAmountCents();
                scheduleDao.insert(planId, seq, option.dueDates().get(i), amount,
                        PaymentScheduleStatus.SCHEDULED.wire(), ScheduleKind.INSTALLMENT.wire());
                seq++;
            }
        } else {
            long totalWithFee = discountedTotal + feeCents;
            long perPayment = Math.round((double) totalWithFee / installmentCount);
            for (int i = 0; i < installmentCount; i++) {
                long amount = (i == installmentCount - 1)
                        ? totalWithFee - perPayment * (installmentCount - 1)
                        : perPayment;
                scheduleDao.insert(planId, seq, option.dueDates().get(i), amount,
                        PaymentScheduleStatus.SCHEDULED.wire(), ScheduleKind.INSTALLMENT.wire());
                seq++;
            }
        }
    }

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
        validateCustomerAndPm(input.paymentMethodId(), input.customerEmail(), input.frequency());

        Outcome outcome = jdbi.inTransaction(handle -> {
            BookingDao bookingDao = handle.attach(BookingDao.class);
            Booking booking = bookingDao.findBySlugAndToken(input.merchantSlug(), input.bookingToken())
                    .orElseThrow(() -> new PlanCreationException(
                            Reason.BOOKING_NOT_FOUND, "booking not found"));
            if (booking.status() != com.bliss.b2b.domain.BookingStatus.SENT) {
                throw new PlanCreationException(Reason.BOOKING_NOT_OPEN,
                        "booking is not open for plan acceptance (status=" + booking.status().wire() + ")");
            }
            Merchant merchant = handle.attach(MerchantDao.class).findById(booking.merchantId()).orElseThrow();
            return acceptForBooking(handle, booking, merchant,
                    input.customerEmail(), input.customerFirstName(), input.customerLastName(),
                    null, input.paymentMethodId(), input.frequency(), input.demoCard());
        });
        return finalize(outcome);
    }

    /**
     * Customer-initiated path: validates the merchant, inserts a fresh
     * booking row with {@code source = customer_initiated} using the cart
     * details from the checkout URL, then runs the shared accept-a-plan
     * logic. Returns the booking_token so the merchant dashboard can link
     * to {@code /pay/{slug}/{token}} the same way it does for
     * merchant-initiated bookings.
     */
    public PlanCreationResult createBookingAndPlan(CustomerCheckoutInput input) {
        validateCustomerAndPm(input.paymentMethodId(), input.customerEmail(), input.frequency());
        if (input.merchantSlug() == null || input.merchantSlug().isBlank()) {
            throw new PlanCreationException(Reason.INVALID_INPUT, "merchantSlug required");
        }
        if (input.totalAmountCents() <= 0) {
            throw new PlanCreationException(Reason.INVALID_INPUT, "totalAmountCents must be positive");
        }
        if (input.appointmentDate() == null) {
            throw new PlanCreationException(Reason.INVALID_INPUT, "appointmentDate (checkin) required");
        }
        if (input.appointmentDate().isBefore(LocalDate.now(clock))) {
            throw new PlanCreationException(Reason.INVALID_INPUT,
                    "appointmentDate must be in the future");
        }
        if (input.checkoutDate() != null && input.checkoutDate().isBefore(input.appointmentDate())) {
            throw new PlanCreationException(Reason.INVALID_INPUT,
                    "checkoutDate must be on or after appointmentDate");
        }

        Outcome outcome = jdbi.inTransaction(handle -> {
            MerchantDao merchantDao = handle.attach(MerchantDao.class);
            Merchant merchant = merchantDao.findBySlug(input.merchantSlug())
                    .orElseThrow(() -> new PlanCreationException(
                            Reason.BOOKING_NOT_FOUND, "merchant not found"));

            BookingDao bookingDao = handle.attach(BookingDao.class);
            String token = mintBookingToken(bookingDao);
            String serviceName = input.description() != null && !input.description().isBlank()
                    ? input.description().trim()
                    : "Booking from checkout link";
            bookingDao.insert(
                    merchant.id(),
                    token,
                    serviceName,
                    null, // service_description — customer's free text is stored as serviceName
                    input.totalAmountCents(),
                    input.appointmentDate(),
                    input.checkoutDate(),
                    null, // cancellationPolicy — uses merchant policy stack
                    trimToNull(input.customerName()),
                    trimToNull(input.customerEmail()),
                    trimToNull(input.customerPhone()),
                    BookingSource.CUSTOMER_INITIATED.wire());
            Booking booking = bookingDao.findByToken(token)
                    .orElseThrow(() -> new IllegalStateException("booking insert disappeared"));

            return acceptForBooking(handle, booking, merchant,
                    input.customerEmail(), splitFirst(input.customerName()), splitLast(input.customerName()),
                    input.customerPhone(), input.paymentMethodId(), input.frequency(), input.demoCard());
        });
        return finalize(outcome);
    }

    /**
     * Shared core: pulls the merchant's plan rules, evaluates eligibility,
     * picks the requested frequency, creates/loads the customer + Stripe
     * customer + card, writes the plan + schedule, marks the booking
     * accepted, fires the first PaymentIntent. Caller owns the transaction.
     *
     * <p>When Stripe is not configured this delegates to
     * {@link #acceptForBookingDemo} which writes the same DB rows with
     * synthesized Stripe IDs and marks the first row PAID without a
     * real network call. This is the single demo-mode branch point for
     * plan creation.
     */
    private Outcome acceptForBooking(
            Handle handle,
            Booking booking,
            Merchant merchant,
            String customerEmail,
            String customerFirstName,
            String customerLastName,
            String customerPhone,
            String paymentMethodId,
            PlanFrequency requestedFrequency,
            DemoCard demoCard
    ) {
        if (!stripeService.isConfigured()) {
            return acceptForBookingDemo(handle, booking, merchant,
                    customerEmail, customerFirstName, customerLastName,
                    customerPhone, paymentMethodId, requestedFrequency, demoCard);
        }
        ConnectStatus connectStatus = ConnectStatus.fromWire(merchant.stripeConnectStatus());
        if (connectStatus != ConnectStatus.CHARGES_ENABLED) {
            throw new PlanCreationException(Reason.MERCHANT_NOT_READY,
                    "merchant has not completed Stripe onboarding");
        }

        MerchantPlanRules rules = handle.attach(MerchantPlanRulesDao.class)
                .findByMerchantId(merchant.id())
                .orElse(MerchantPlanRules.DEFAULTS);

        LocalDate today = LocalDate.now(clock);
        // Prefer the booking's pre-discount price when present so a
        // re-evaluation of an already-discounted booking row doesn't double-
        // discount. For freshly-created bookings, total_amount_cents is the
        // published price.
        long evaluateInput = booking.originalTotalAmountCents() != null
                ? booking.originalTotalAmountCents()
                : booking.totalAmountCents();
        EligibilityResult eligibility = eligibilityService.evaluate(
                today, booking.appointmentDate(), evaluateInput, rules);
        if (!eligibility.eligible()) {
            throw new PlanCreationException(Reason.ELIGIBILITY_FAILED,
                    "booking does not satisfy this merchant's plan rules (" + eligibility.reason() + ")");
        }
        PlanOption option = eligibility.options().stream()
                .filter(o -> o.frequency() == requestedFrequency)
                .findFirst()
                .orElseThrow(() -> new PlanCreationException(
                        Reason.ELIGIBILITY_FAILED,
                        requestedFrequency.wire() + " is not an eligible frequency for this booking"));

        CustomerDao customerDao = handle.attach(CustomerDao.class);
        CustomerCardDao cardDao = handle.attach(CustomerCardDao.class);
        PaymentPlanDao planDao = handle.attach(PaymentPlanDao.class);
        PaymentScheduleDao scheduleDao = handle.attach(PaymentScheduleDao.class);
        BookingDao bookingDao = handle.attach(BookingDao.class);

        String email = customerEmail.trim().toLowerCase();
        Customer customer = customerDao.findByEmail(email).orElseGet(() -> {
            customerDao.insert(email, trimToNull(customerFirstName), trimToNull(customerLastName));
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
            pm = stripeService.attachPaymentMethod(paymentMethodId, stripeCustomerId);
        } catch (CardException e) {
            throw declined(e);
        } catch (StripeException e) {
            throw stripeFailure(e);
        }
        CardSummary card = StripePaymentsService.summarize(pm);
        cardDao.insert(customer.id(), pm.getId(),
                card.lastFour(), card.expMonth(), card.expYear(), card.brand(), true);
        CustomerCard storedCard = cardDao.findByPaymentMethodId(pm.getId()).orElseThrow();

        long depositAmount = eligibility.depositAmountCents();
        boolean hasDeposit = depositAmount > 0;
        int installmentCount = option.numPayments();
        LocalDate startDate = hasDeposit ? today : option.dueDates().get(0);
        LocalDate endDate = option.dueDates().get(installmentCount - 1);

        long discountedTotal = eligibility.discountedTotalAmountCents();
        long originalTotal = eligibility.originalTotalAmountCents();
        // Persist the discount on the booking when one applied so the merchant
        // dashboard can show the savings. No-op when total equals total.
        if (discountedTotal != originalTotal) {
            bookingDao.applyPlanDiscount(booking.id(), discountedTotal, originalTotal);
            booking = bookingDao.findById(booking.id()).orElseThrow();
        }

        long feeCents = feeFor(discountedTotal);
        planDao.insert(
                booking.id(),
                customer.id(),
                storedCard.id(),
                discountedTotal,
                installmentCount,
                option.frequency().wire(),
                startDate,
                endDate,
                depositAmount,
                feeCents);
        PaymentPlan plan = planDao.findActiveForBooking(booking.id())
                .orElseThrow(() -> new IllegalStateException("plan insert disappeared"));

        buildSchedule(scheduleDao, plan.id(), today, hasDeposit, depositAmount,
                feeCents, discountedTotal, installmentCount, option);

        int markedAccepted = bookingDao.markAccepted(booking.id(), customer.id());
        if (markedAccepted != 1) {
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
                            "bliss_booking_id", booking.id().toString(),
                            "bliss_kind", first.kind().wire()));
        } catch (CardException e) {
            throw declined(e);
        } catch (StripeException e) {
            throw stripeFailure(e);
        }

        String paymentStatus = firstIntent.getStatus() == null ? "" : firstIntent.getStatus();
        PaymentScheduleStatus newStatus = mapIntentToStatus(paymentStatus);
        scheduleDao.recordAttempt(plan.id(), first.sequence(), newStatus.wire(),
                firstIntent.getId(), java.time.Instant.now(clock));
        if (newStatus == PaymentScheduleStatus.FAILED) {
            throw new PlanCreationException(Reason.CARD_DECLINED,
                    "first payment was not completed (status=" + paymentStatus + ")");
        }
        if (newStatus == PaymentScheduleStatus.SCHEDULED) {
            throw new PlanCreationException(Reason.CARD_REQUIRES_ACTION,
                    "card requires authentication; please use a different card");
        }

        if (customerPhone != null && !customerPhone.isBlank()) {
            // Best-effort store on the Customer row when we have one and didn't
            // already. Doesn't fail the plan if the update is a no-op.
            // (Avoiding a setPhone DAO method for now; phone-on-customer is
            // wired in a future phase.)
        }

        return new Outcome(merchant, customer, booking, plan, schedule,
                firstIntent.getId(), paymentStatus);
    }

    /**
     * Demo-mode counterpart of {@link #acceptForBooking}. Writes the same DB
     * rows the real path writes — booking row updates, customer, customer
     * card, payment plan, payment schedule rows — but skips every Stripe
     * network call and uses synthesized {@code *_demo_*} identifiers. The
     * first schedule row (deposit when present, else first installment) is
     * marked PAID immediately so the portal renders consistent paid/upcoming
     * state. Eligibility, fee-in-deposit math, and 1st-of-month anchoring are
     * shared with the real path — only the Stripe side branches.
     */
    private Outcome acceptForBookingDemo(
            Handle handle,
            Booking booking,
            Merchant merchant,
            String customerEmail,
            String customerFirstName,
            String customerLastName,
            String customerPhone,
            String paymentMethodId,
            PlanFrequency requestedFrequency,
            DemoCard demoCard
    ) {
        ConnectStatus connectStatus = ConnectStatus.fromWire(merchant.stripeConnectStatus());
        if (connectStatus != ConnectStatus.CHARGES_ENABLED) {
            throw new PlanCreationException(Reason.MERCHANT_NOT_READY,
                    "merchant has not completed Stripe onboarding");
        }

        MerchantPlanRules rules = handle.attach(MerchantPlanRulesDao.class)
                .findByMerchantId(merchant.id())
                .orElse(MerchantPlanRules.DEFAULTS);

        LocalDate today = LocalDate.now(clock);
        long evaluateInput = booking.originalTotalAmountCents() != null
                ? booking.originalTotalAmountCents()
                : booking.totalAmountCents();
        EligibilityResult eligibility = eligibilityService.evaluate(
                today, booking.appointmentDate(), evaluateInput, rules);
        if (!eligibility.eligible()) {
            throw new PlanCreationException(Reason.ELIGIBILITY_FAILED,
                    "booking does not satisfy this merchant's plan rules (" + eligibility.reason() + ")");
        }
        PlanOption option = eligibility.options().stream()
                .filter(o -> o.frequency() == requestedFrequency)
                .findFirst()
                .orElseThrow(() -> new PlanCreationException(
                        Reason.ELIGIBILITY_FAILED,
                        requestedFrequency.wire() + " is not an eligible frequency for this booking"));

        CustomerDao customerDao = handle.attach(CustomerDao.class);
        CustomerCardDao cardDao = handle.attach(CustomerCardDao.class);
        PaymentPlanDao planDao = handle.attach(PaymentPlanDao.class);
        PaymentScheduleDao scheduleDao = handle.attach(PaymentScheduleDao.class);
        BookingDao bookingDao = handle.attach(BookingDao.class);

        String email = customerEmail.trim().toLowerCase();
        Customer customer = customerDao.findByEmail(email).orElseGet(() -> {
            customerDao.insert(email, trimToNull(customerFirstName), trimToNull(customerLastName));
            return customerDao.findByEmail(email).orElseThrow();
        });

        String stripeCustomerId = customer.stripeCustomerId();
        if (stripeCustomerId == null || stripeCustomerId.isBlank()) {
            stripeCustomerId = StripeIds.customerId();
            customerDao.setStripeCustomerId(customer.id(), stripeCustomerId);
            customer = customerDao.findById(customer.id()).orElseThrow();
        }

        // Honor a pm_demo_* id the frontend already minted (for traceability
        // back to the form submission); otherwise mint a fresh one.
        String pmId = paymentMethodId != null && paymentMethodId.startsWith("pm_demo_")
                ? paymentMethodId
                : StripeIds.paymentMethodId();
        String lastFour = demoCard != null && demoCard.lastFour() != null
                ? demoCard.lastFour() : "4242";
        int expMonth = demoCard != null && demoCard.expMonth() != null
                ? demoCard.expMonth() : 12;
        int expYear = demoCard != null && demoCard.expYear() != null
                ? demoCard.expYear() : 2030;
        String brand = demoCard != null && demoCard.brand() != null
                ? demoCard.brand() : "visa";

        cardDao.insert(customer.id(), pmId, lastFour, expMonth, expYear, brand, true);
        CustomerCard storedCard = cardDao.findByPaymentMethodId(pmId).orElseThrow();

        long depositAmount = eligibility.depositAmountCents();
        boolean hasDeposit = depositAmount > 0;
        int installmentCount = option.numPayments();
        LocalDate startDate = hasDeposit ? today : option.dueDates().get(0);
        LocalDate endDate = option.dueDates().get(installmentCount - 1);

        long discountedTotal = eligibility.discountedTotalAmountCents();
        long originalTotal = eligibility.originalTotalAmountCents();
        if (discountedTotal != originalTotal) {
            bookingDao.applyPlanDiscount(booking.id(), discountedTotal, originalTotal);
            booking = bookingDao.findById(booking.id()).orElseThrow();
        }

        long feeCents = feeFor(discountedTotal);
        planDao.insert(
                booking.id(), customer.id(), storedCard.id(),
                discountedTotal, installmentCount, option.frequency().wire(),
                startDate, endDate, depositAmount, feeCents);
        PaymentPlan plan = planDao.findActiveForBooking(booking.id())
                .orElseThrow(() -> new IllegalStateException("plan insert disappeared"));

        // Byte-identical schedule to the real path so the shape is the same
        // whether or not Stripe is configured.
        buildSchedule(scheduleDao, plan.id(), today, hasDeposit, depositAmount,
                feeCents, discountedTotal, installmentCount, option);

        int markedAccepted = bookingDao.markAccepted(booking.id(), customer.id());
        if (markedAccepted != 1) {
            throw new PlanCreationException(Reason.BOOKING_NOT_OPEN,
                    "booking was just accepted by another session");
        }

        List<PaymentScheduleEntry> schedule = scheduleDao.listForPlan(plan.id());
        PaymentScheduleEntry first = schedule.get(0);

        // Mark the first row PAID right now with a synthetic intent id. No
        // Stripe call. Re-fetch the schedule so the returned list reflects
        // the new status.
        String demoIntentId = StripeIds.intentIdFor(first.id());
        scheduleDao.markPaidNow(first.id(), demoIntentId, java.time.Instant.now(clock));
        schedule = scheduleDao.listForPlan(plan.id());

        if (customerPhone != null) {
            // Same no-op the real path has; phone-on-customer is a future phase.
        }

        return new Outcome(merchant, customer, booking, plan, schedule,
                demoIntentId, "succeeded");
    }

    private PlanCreationResult finalize(Outcome outcome) {
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

    private static void validateCustomerAndPm(String pmId, String email, PlanFrequency frequency) {
        if (pmId == null || pmId.isBlank()) {
            throw new PlanCreationException(Reason.INVALID_INPUT, "paymentMethodId required");
        }
        if (email == null || email.isBlank()) {
            throw new PlanCreationException(Reason.INVALID_INPUT, "customerEmail required");
        }
        if (frequency == null) {
            throw new PlanCreationException(Reason.INVALID_INPUT, "frequency required");
        }
    }

    private static String mintBookingToken(BookingDao bookingDao) {
        for (int attempt = 0; attempt < TOKEN_INSERT_RETRIES; attempt++) {
            byte[] bytes = new byte[TOKEN_BYTES];
            RNG.nextBytes(bytes);
            String token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
            if (bookingDao.findByToken(token).isEmpty()) return token;
        }
        throw new IllegalStateException("Could not mint a unique booking token");
    }

    private static String splitFirst(String fullName) {
        if (fullName == null) return null;
        String trimmed = fullName.trim();
        if (trimmed.isEmpty()) return null;
        int sp = trimmed.indexOf(' ');
        return sp < 0 ? trimmed : trimmed.substring(0, sp);
    }

    private static String splitLast(String fullName) {
        if (fullName == null) return null;
        String trimmed = fullName.trim();
        int sp = trimmed.lastIndexOf(' ');
        return sp < 0 ? null : trimmed.substring(sp + 1);
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
        webhookLog.info(
                "plan.started merchant={} booking={} plan={} customer={} frequency={} numPayments={} firstIntent={} source={}",
                o.merchant().id(), o.booking().id(), o.plan().id(),
                o.customer().id(), o.plan().frequency().wire(), o.plan().numPayments(),
                o.firstChargeIntentId(), o.booking().source().wire());
    }

    static PaymentScheduleStatus mapIntentToStatus(String paymentIntentStatus) {
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
            PlanFrequency frequency,
            DemoCard demoCard
    ) {}

    /**
     * Customer-initiated checkout: the customer landed on
     * {@code /checkout/{slug}} with cart details in the URL.
     * {@code customerName} is split into first/last on the server because
     * the URL spec passes a single {@code name=John+Doe} param.
     */
    public record CustomerCheckoutInput(
            String merchantSlug,
            long totalAmountCents,
            LocalDate appointmentDate,
            LocalDate checkoutDate,
            String description,
            String customerName,
            String customerEmail,
            String customerPhone,
            String paymentMethodId,
            PlanFrequency frequency,
            DemoCard demoCard
    ) {}

    /**
     * Optional card metadata used only by the demo-mode plan creation path.
     * The frontend's DemoCardSection forwards what the customer typed so the
     * persisted card row reflects the on-screen card rather than a hardcoded
     * default. All fields nullable — defaults apply when null.
     */
    public record DemoCard(
            String lastFour,
            Integer expMonth,
            Integer expYear,
            String brand
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
