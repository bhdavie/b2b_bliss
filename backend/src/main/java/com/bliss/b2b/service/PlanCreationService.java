package com.bliss.b2b.service;

import com.bliss.b2b.BlissConfiguration.AppConfig;
import com.bliss.b2b.domain.Booking;
import com.bliss.b2b.domain.BookingSource;
import com.bliss.b2b.domain.ConnectStatus;
import com.bliss.b2b.domain.Customer;
import com.bliss.b2b.domain.CustomerCard;
import com.bliss.b2b.domain.Merchant;
import com.bliss.b2b.domain.PaymentPlan;
import com.bliss.b2b.domain.PaymentPlanStatus;
import com.bliss.b2b.domain.PaymentScheduleEntry;
import com.bliss.b2b.domain.PaymentScheduleStatus;
import com.bliss.b2b.domain.PmsType;
import com.bliss.b2b.domain.MewsConnection;
import com.bliss.b2b.domain.ScheduleKind;
import com.bliss.b2b.integration.EmailService;
import com.bliss.b2b.integration.EmailTemplates;
import com.bliss.b2b.integration.StripeConnectResolver;
import com.bliss.b2b.integration.StripePaymentsService;
import com.bliss.b2b.integration.StripePaymentsService.CardSummary;
import com.bliss.b2b.payments.EligibilityResult;
import com.bliss.b2b.payments.MerchantPlanRules;
import com.bliss.b2b.payments.PlanEligibilityService;
import com.bliss.b2b.payments.PlanFrequency;
import com.bliss.b2b.payments.PlanOption;
import com.bliss.b2b.payments.PropertyLocale;
import com.bliss.b2b.persistence.BookingDao;
import com.bliss.b2b.persistence.CustomerCardDao;
import com.bliss.b2b.persistence.CustomerDao;
import com.bliss.b2b.persistence.MerchantDao;
import com.bliss.b2b.persistence.MerchantFeeRateDao;
import com.bliss.b2b.persistence.MerchantMewsConnectionDao;
import com.bliss.b2b.persistence.MewsLinkingDao;
import com.bliss.b2b.persistence.MerchantPlanRulesDao;
import com.bliss.b2b.persistence.PaymentPlanDao;
import com.bliss.b2b.persistence.PaymentScheduleDao;
import com.bliss.b2b.service.PlanCreationException.Reason;
import com.stripe.exception.CardException;
import com.stripe.exception.StripeException;
import com.stripe.model.PaymentIntent;
import com.stripe.model.PaymentMethod;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Instant;
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
     * Fallback ONLY, for a property with no row in {@code merchant_fee_rates}.
     * This is not the applied rate: the applied rate is resolved per property
     * and per moment by {@link #resolveFeeRate}. V27 backfilled every existing
     * property at 0.05, so reaching this constant means either a property
     * created after that migration with no rate written, or a rate whose
     * effective_from is still in the future. Both are configuration gaps rather
     * than normal operation, which is why the resolver logs a warning.
     *
     * <p>Deliberately not zero. A missing rate is a mistake, and defaulting to
     * "Bliss takes nothing" would hide it behind revenue that quietly stops.
     */
    private static final BigDecimal FALLBACK_FEE_RATE = new BigDecimal("0.05");

    /**
     * The same fallback, readable by the public quote endpoint so a quote and
     * the plan it turns into cannot disagree about what a property with no rate
     * row is charged. Exposed rather than duplicated for exactly that reason.
     */
    public static final BigDecimal FALLBACK_FEE_RATE_PUBLIC = FALLBACK_FEE_RATE;

    /** Legacy flat fee, retained only for the V13 backfill of pre-migration plans. */
    public static final long LEGACY_FLAT_FEE_CENTS = 2000L;

    /**
     * The property's fee rate as of {@code at}: the newest row in
     * {@code merchant_fee_rates} whose effective_from has arrived. Resolved ONCE
     * per plan creation and threaded down, so a plan cannot straddle two rates
     * and the DAO is not queried per installment.
     */
    private static BigDecimal resolveFeeRate(Handle handle, UUID merchantId, Instant at) {
        BigDecimal resolved = handle.attach(MerchantFeeRateDao.class)
                .effectiveRateFor(merchantId, at)
                .orElse(null);
        if (resolved == null) {
            log.warn("No effective merchant_fee_rates row for merchant {} as of {}; "
                    + "falling back to {}", merchantId, at, FALLBACK_FEE_RATE);
            return FALLBACK_FEE_RATE;
        }
        return resolved;
    }

    /**
     * The fee in whole cents for a plan total at a resolved rate, rounded
     * half-up to match what the old {@code Math.round(total * 0.05)} produced
     * for the same inputs.
     *
     * <p>A rate of exactly 0 yields 0, which is a real value and not an absent
     * one: the caller still writes {@code processing_fee_cents = 0}.
     */
    static long feeFor(long totalCents, BigDecimal rate) {
        if (rate == null || rate.signum() <= 0 || totalCents <= 0) {
            return 0L;
        }
        return BigDecimal.valueOf(totalCents)
                .multiply(rate)
                .setScale(0, RoundingMode.HALF_UP)
                .longValueExact();
    }

    /**
     * Layer the Bliss fee onto the customer schedule. With a deposit the fee
     * rides the deposit and the installments stay clean ((discountedTotal -
     * deposit)/N). With no deposit the fee-inclusive total is split the same way
     * eligibility splits everything: floor division in minor units, the final
     * installment taking the remainder, so it is never smaller than the others.
     * The frontend mirrors ({@code splitInstallments}) use the
     * same rule. Either way SUM(schedule) == discountedTotal + feeCents, in
     * whatever minor unit the booking's currency has.
     */
    // Package-private, not private: PlanCreationFeeRateTest drives it directly
    // to prove SUM(schedule) == discountedTotal + feeCents still holds at a 0%
    // rate, which is the one case the fee refactor could plausibly break.
    static void buildSchedule(
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
            // The deposit is payment 1: checkout charges it on plan creation,
            // so it is dated today, weekend or not. Only later payments roll.
            LocalDate depositDate = today;
            scheduleDao.insert(planId, seq, depositDate, depositAmount + feeCents,
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
            long perPayment = totalWithFee / installmentCount;
            long finalPayment = totalWithFee - perPayment * (installmentCount - 1);
            for (int i = 0; i < installmentCount; i++) {
                long amount = (i == installmentCount - 1) ? finalPayment : perPayment;
                scheduleDao.insert(planId, seq, option.dueDates().get(i), amount,
                        PaymentScheduleStatus.SCHEDULED.wire(), ScheduleKind.INSTALLMENT.wire());
                seq++;
            }
        }
    }

    private final Jdbi jdbi;
    private final PlanEligibilityService eligibilityService;
    private final StripePaymentsService stripeService;
    private final StripeConnectResolver stripeConnectResolver;
    private final EmailService emailService;
    private final Clock clock;
    private final AppConfig appConfig;

    private final PlanNotificationService notificationService;

    public PlanCreationService(
            Jdbi jdbi,
            PlanEligibilityService eligibilityService,
            StripePaymentsService stripeService,
            StripeConnectResolver stripeConnectResolver,
            EmailService emailService,
            PlanNotificationService notificationService,
            Clock clock,
            AppConfig appConfig
    ) {
        this.jdbi = jdbi;
        this.eligibilityService = eligibilityService;
        this.stripeService = stripeService;
        this.stripeConnectResolver = stripeConnectResolver;
        this.emailService = emailService;
        this.notificationService = notificationService;
        this.clock = clock;
        this.appConfig = appConfig;
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
            if (merchant.pmsType() == com.bliss.b2b.domain.PmsType.MEWS
                    && !appConfig.isDemoMewsProperty(merchant.slug())) {
                // A dashboard link has no Mews reservation behind it. Links made
                // before this rule land here. Listed demo properties pass and
                // take the demo payment path below.
                throw new PlanCreationException(Reason.MERCHANT_NOT_READY,
                        "This property takes payment plans through its own booking page. "
                                + "Book your stay there to choose a plan.");
            }
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
        if (input.appointmentDate() == null) {
            throw new PlanCreationException(Reason.INVALID_INPUT, "appointmentDate (checkin) required");
        }
        if (input.checkoutDate() != null && input.checkoutDate().isBefore(input.appointmentDate())) {
            throw new PlanCreationException(Reason.INVALID_INPUT,
                    "checkoutDate must be on or after appointmentDate");
        }

        // A Mews property's guests book and pay in its own Mews booking engine;
        // Bliss builds the plan from the reservation (MewsLinkService).
        Merchant preMerchant = jdbi.withExtension(MerchantDao.class, d -> d.findBySlug(input.merchantSlug()))
                .orElseThrow(() -> new PlanCreationException(Reason.BOOKING_NOT_FOUND, "merchant not found"));
        if (preMerchant.pmsType() == com.bliss.b2b.domain.PmsType.MEWS) {
            throw new PlanCreationException(Reason.MERCHANT_NOT_READY,
                    "This property takes payment plans through its own booking page. "
                            + "Book your stay there to choose a plan.");
        }
        if (preMerchant.propertyLocale().isEmpty()) {
            throw new PlanCreationException(Reason.MERCHANT_NOT_READY,
                    "This property has not set its currency yet. Contact the property to book.");
        }
        if (input.currency() != null && !input.currency().isBlank()
                && !input.currency().trim().equalsIgnoreCase(preMerchant.currency())) {
            throw new PlanCreationException(Reason.INVALID_INPUT,
                    "This checkout is priced in " + input.currency().trim().toUpperCase(java.util.Locale.ROOT)
                            + " but the property takes payment in " + preMerchant.currency() + ".");
        }
        if (input.appointmentDate().isBefore(PropertyLocale.today(clock, preMerchant.timeZone()))) {
            throw new PlanCreationException(Reason.INVALID_INPUT,
                    "appointmentDate must be in the future");
        }
        long totalAmountCents = input.totalAmountCents();
        if (totalAmountCents <= 0) {
            throw new PlanCreationException(Reason.INVALID_INPUT, "totalAmountCents must be positive");
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
            int inserted = bookingDao.insert(
                    merchant.id(),
                    token,
                    serviceName,
                    null, // service_description — customer's free text is stored as serviceName
                    totalAmountCents,
                    input.appointmentDate(),
                    input.checkoutDate(),
                    null, // cancellationPolicy — uses merchant policy stack
                    trimToNull(input.customerName()),
                    trimToNull(input.customerEmail()),
                    trimToNull(input.customerPhone()),
                    BookingSource.CUSTOMER_INITIATED.wire());
            if (inserted == 0) {
                throw new PlanCreationException(Reason.MERCHANT_NOT_READY,
                        "This property has not set its currency yet. Contact the property to book.");
            }
            Booking booking = bookingDao.findByToken(token)
                    .orElseThrow(() -> new IllegalStateException("booking insert disappeared"));

            // Explicit name parts win over splitting the single name field:
            // "Mary Ann Smith" splits wrongly, and a one-word name has no last.
            String firstName = trimToNull(input.customerFirstName()) != null
                    ? input.customerFirstName() : splitFirst(input.customerName());
            String lastName = trimToNull(input.customerLastName()) != null
                    ? input.customerLastName() : splitLast(input.customerName());
            return acceptForBooking(handle, booking, merchant,
                    input.customerEmail(), firstName, lastName,
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
        // Resolved once, here, and threaded down to the fee calculation. Doing it
        // at the top means the whole plan is priced at one rate even if a rate
        // row lands mid-transaction, and the DAO is hit once per plan rather
        // than once per installment.
        BigDecimal feeRate = resolveFeeRate(handle, merchant.id(), clock.instant());
        // Rail fork. Mews plans are never accepted here: they are built from the
        // guest's booking-engine reservation (createFromMewsReservation), and
        // both entry points refuse a Mews property before reaching this.
        if (merchant.pmsType() == PmsType.MEWS) {
            if (appConfig.isDemoMewsProperty(merchant.slug())) {
                // A listed demo property: synthetic card and payment ids, no
                // Stripe and no Mews call, even where Stripe is configured.
                return acceptForBookingDemo(handle, booking, merchant,
                        customerEmail, customerFirstName, customerLastName,
                        customerPhone, paymentMethodId, requestedFrequency, demoCard);
            }
            throw new PlanCreationException(Reason.MERCHANT_NOT_READY,
                    "Mews plans are created from the property's booking engine");
        }
        if (merchant.pmsType() == PmsType.CLOUDBEDS) {
            // Third rail recognized. End-to-end plan acceptance needs a vaulted
            // Cloudbeds card, which comes from the guest-checkout tokenization
            // seam (not built — Cloudbeds has no server-issued hosted card-entry
            // request). Fail clearly rather than create an unfulfillable plan.
            throw new PlanCreationException(Reason.MERCHANT_NOT_READY,
                    "Cloudbeds is connected, but guest card capture is not yet available "
                            + "(tokenization seam pending). Contact the property to book.");
        }
        if (!stripeService.isConfigured()) {
            return acceptForBookingDemo(handle, booking, merchant,
                    customerEmail, customerFirstName, customerLastName,
                    customerPhone, paymentMethodId, requestedFrequency, demoCard);
        }
        // Per-property Connect Standard: when the property has finished Standard
        // onboarding its account is the destination of the charge, and Bliss
        // keeps application_fee_amount. Every Stripe object below still lives on
        // the platform, so the guest's card is vaulted once and reusable for the
        // later installments. When there is no connected account we fall back to
        // the existing Express gate and a plain platform charge.
        String connectedAccountId = stripeConnectResolver.resolveOrNull(merchant.id());
        if (connectedAccountId == null) {
            ConnectStatus connectStatus = ConnectStatus.fromWire(merchant.stripeConnectStatus());
            if (connectStatus != ConnectStatus.CHARGES_ENABLED) {
                throw new PlanCreationException(Reason.MERCHANT_NOT_READY,
                        "property has not completed Stripe onboarding");
            }
        }
        StripePaymentsService.Destination destination = new StripePaymentsService.Destination(
                connectedAccountId,
                handle.attach(MerchantDao.class).findFeePercentage(merchant.id()).orElse(null));

        MerchantPlanRules rules = handle.attach(MerchantPlanRulesDao.class)
                .findByMerchantId(merchant.id())
                .orElse(MerchantPlanRules.DEFAULTS);

        // Calendar days are the property's: a guest booking at 23:00 in Los
        // Angeles is still on that day, not the next UTC one.
        LocalDate today = propertyLocaleOf(booking).today(clock);
        // Prefer the booking's pre-discount price when present so a
        // re-evaluation of an already-discounted booking row doesn't double-
        // discount. For freshly-created bookings, total_amount_cents is the
        // published price.
        long evaluateInput = booking.originalTotalAmountCents() != null
                ? booking.originalTotalAmountCents()
                : booking.totalAmountCents();
        EligibilityResult eligibility = eligibilityService.evaluate(
                today, booking.appointmentDate(), booking.checkoutDate(), evaluateInput, rules);
        if (!eligibility.eligible()) {
            throw new PlanCreationException(Reason.ELIGIBILITY_FAILED,
                    "booking does not satisfy this property's plan rules (" + eligibility.reason() + ")");
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
        // Keep the customer's name current with what this guest entered at
        // checkout, so a returning email reflects the latest booking instead of
        // a stale name. New emails already inserted the name above.
        customerDao.updateName(customer.id(), trimToNull(customerFirstName), trimToNull(customerLastName));
        customer = customerDao.findById(customer.id()).orElseThrow();

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

        long feeCents = feeFor(discountedTotal, feeRate);
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
                feeCents,
                railFor(merchant));
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
                    booking.currency(),
                    stripeCustomerId,
                    pm.getId(),
                    first.id().toString(),
                    Map.of(
                            "bliss_payment_schedule_id", first.id().toString(),
                            "bliss_payment_plan_id", plan.id().toString(),
                            "bliss_booking_id", booking.id().toString(),
                            "bliss_kind", first.kind().wire()),
                    destination,
                    // Guest is on the checkout page: vault the card here so the
                    // scheduler can charge installments 2..N off-session.
                    StripePaymentsService.SessionMode.ON_SESSION_VAULT);
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
        // Resolved once, here, and threaded down to the fee calculation. Doing it
        // at the top means the whole plan is priced at one rate even if a rate
        // row lands mid-transaction, and the DAO is hit once per plan rather
        // than once per installment.
        BigDecimal feeRate = resolveFeeRate(handle, merchant.id(), clock.instant());
        // Demo / simulated mode (reached only when Stripe is not configured):
        // this path skips every Stripe network call and synthesizes ids, so it
        // does NOT require the merchant to be Stripe-connected. The real-Stripe
        // path in acceptForBooking keeps the charges_enabled gate for production.

        MerchantPlanRules rules = handle.attach(MerchantPlanRulesDao.class)
                .findByMerchantId(merchant.id())
                .orElse(MerchantPlanRules.DEFAULTS);

        // Calendar days are the property's: a guest booking at 23:00 in Los
        // Angeles is still on that day, not the next UTC one.
        LocalDate today = propertyLocaleOf(booking).today(clock);
        long evaluateInput = booking.originalTotalAmountCents() != null
                ? booking.originalTotalAmountCents()
                : booking.totalAmountCents();
        EligibilityResult eligibility = eligibilityService.evaluate(
                today, booking.appointmentDate(), booking.checkoutDate(), evaluateInput, rules);
        if (!eligibility.eligible()) {
            throw new PlanCreationException(Reason.ELIGIBILITY_FAILED,
                    "booking does not satisfy this property's plan rules (" + eligibility.reason() + ")");
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
        // Keep the customer's name current with what this guest entered at
        // checkout, so a returning email reflects the latest booking instead of
        // a stale name. New emails already inserted the name above.
        customerDao.updateName(customer.id(), trimToNull(customerFirstName), trimToNull(customerLastName));
        customer = customerDao.findById(customer.id()).orElseThrow();

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

        long feeCents = feeFor(discountedTotal, feeRate);
        planDao.insert(
                booking.id(), customer.id(), storedCard.id(),
                discountedTotal, installmentCount, option.frequency().wire(),
                startDate, endDate, depositAmount, feeCents,
                railFor(merchant));
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

    /**
     * Builds the plan for a reservation the guest made in the property's Mews
     * booking engine, on one of its Bliss rates.
     *
     * <p>Mews already holds the booking, the card and the upfront charge. Bliss
     * does not re-price or re-book anything: the total is what Mews bills for
     * the reservation, the deposit is whatever the rate charged at booking, and
     * the plan is the remainder (plus the Bliss fee) on the schedule the rate
     * stands for. The deposit is written as payment 1, already paid, under the
     * Mews payment id that took it. Nothing is charged here.
     *
     * <p>Plan rules still gate it (lead time, amount limits, blackout dates,
     * allowed schedules), but a plan discount is not applied: the Bliss rate's
     * own price in Mews is the price, and discounting it here would leave the
     * reservation's bill underpaid.
     *
     * <p>Runs in one transaction with the link row: if the row is no longer
     * pending (another pass linked it), everything rolls back.
     *
     * @throws PlanCreationException ELIGIBILITY_FAILED when the stay does not
     *         qualify for a plan on that schedule; the caller flags it
     */
    public PlanCreationResult createFromMewsReservation(MewsLinkedStay stay) {
        if (stay.depositCents() <= 0) {
            throw new PlanCreationException(Reason.INVALID_INPUT, "no upfront charge to use as the deposit");
        }
        if (trimToNull(stay.customerEmail()) == null) {
            throw new PlanCreationException(Reason.INVALID_INPUT, "the guest has no email in Mews");
        }
        Outcome outcome = jdbi.inTransaction(handle -> {
            Merchant merchant = handle.attach(MerchantDao.class).findById(stay.merchantId())
                    .orElseThrow(() -> new PlanCreationException(Reason.BOOKING_NOT_FOUND, "merchant not found"));
            MerchantPlanRules rules = handle.attach(MerchantPlanRulesDao.class)
                    .findByMerchantId(merchant.id())
                    .orElse(MerchantPlanRules.DEFAULTS);
            BigDecimal feeRate = resolveFeeRate(handle, merchant.id(), clock.instant());

            // The property's own today: lead time, anchors and weekend rolls are
            // all property-local calendar days.
            LocalDate today = PropertyLocale.today(clock, merchant.timeZone());
            EligibilityResult eligibility = eligibilityService.evaluate(
                    today, stay.checkin(), stay.checkout(), stay.totalCents(), rules);
            if (!eligibility.eligible()) {
                throw new PlanCreationException(Reason.ELIGIBILITY_FAILED, eligibility.reason());
            }
            if (!rules.allowedFrequencies().includes(stay.frequency())) {
                throw new PlanCreationException(Reason.ELIGIBILITY_FAILED,
                        stay.frequency().wire() + "_not_offered");
            }
            long feeCents = feeFor(stay.totalCents(), feeRate);
            long remainder = stay.totalCents() + feeCents - stay.depositCents();
            if (remainder <= 0) {
                throw new PlanCreationException(Reason.ELIGIBILITY_FAILED, "paid_in_full_at_booking");
            }
            PlanOption option = eligibilityService.installmentPlanFor(
                    today, stay.checkin(), remainder, stay.frequency(), rules.paymentDueOffsetDays(), true);
            if (option == null) {
                throw new PlanCreationException(Reason.ELIGIBILITY_FAILED, "no_plan_fits");
            }
            if (feeCents > 0) {
                // Balanced on the folio by the "Bliss service fee" line
                // (FeeLineService) when that is on and has a service to post to.
                log.info("Mews plan for reservation {} (merchant {}) adds a {} Bliss fee on top of the "
                        + "Mews bill of {}", stay.reservationId(), merchant.id(), feeCents, stay.totalCents());
            }

            BookingDao bookingDao = handle.attach(BookingDao.class);
            String token = mintBookingToken(bookingDao);
            String guestName = joinName(stay.customerFirstName(), stay.customerLastName());
            if (bookingDao.insert(
                    merchant.id(), token, stay.serviceName(), stay.serviceDescription(),
                    stay.totalCents(), stay.checkin(), stay.checkout(),
                    null, guestName, stay.customerEmail().trim().toLowerCase(), null,
                    BookingSource.MEWS_IMPORT.wire()) == 0) {
                throw new PlanCreationException(Reason.MERCHANT_NOT_READY, "property has no currency");
            }
            if (!merchant.propertyLocale().map(PropertyLocale::currency).orElse("").equals(stay.currency())) {
                // The amounts read from Mews are minor units of stay.currency();
                // a plan in any other currency would charge the wrong amounts.
                throw new PlanCreationException(Reason.MERCHANT_NOT_READY,
                        "reservation is in " + stay.currency() + " but the property trades in "
                                + merchant.currency());
            }
            Booking booking = bookingDao.findByToken(token)
                    .orElseThrow(() -> new IllegalStateException("booking insert disappeared"));
            if (stay.bookingType() != null && stay.cancellationTerms() != null) {
                bookingDao.setCancellationSnapshot(booking.id(), stay.bookingType().wire(),
                        com.bliss.b2b.persistence.BlissRateDao.termsJson(stay.cancellationTerms()),
                        stay.freeCancellationUntil());
            }
            MewsLinkingDao linkingDao = handle.attach(MewsLinkingDao.class);
            if (linkingDao.attachReservation(booking.id(), stay.reservationId(), stay.categoryId(),
                    stay.rateId(), stay.startUtc(), stay.endUtc(), clock.instant()) != 1) {
                throw new IllegalStateException("could not attach reservation to new booking");
            }

            CustomerDao customerDao = handle.attach(CustomerDao.class);
            String email = stay.customerEmail().trim().toLowerCase();
            Customer customer = customerDao.findByEmail(email).orElseGet(() -> {
                customerDao.insert(email, trimToNull(stay.customerFirstName()), trimToNull(stay.customerLastName()));
                return customerDao.findByEmail(email).orElseThrow();
            });
            customerDao.updateName(customer.id(), trimToNull(stay.customerFirstName()),
                    trimToNull(stay.customerLastName()));
            customerDao.setMewsCustomerId(customer.id(), stay.mewsCustomerId());
            customer = customerDao.findById(customer.id()).orElseThrow();

            // stripe_payment_method_id is NOT NULL UNIQUE; one row per linked
            // reservation, since a returning guest's card backs several plans.
            CustomerCardDao cardDao = handle.attach(CustomerCardDao.class);
            String cardKey = "mews_link_" + stay.reservationId();
            cardDao.insert(customer.id(), cardKey, stay.cardLastFour(),
                    stay.cardExpMonth(), stay.cardExpYear(), stay.cardBrand(), true);
            CustomerCard card = cardDao.findByPaymentMethodId(cardKey).orElseThrow();
            cardDao.setMewsCard(card.id(), stay.mewsCreditCardId(), stay.cardLastFour(),
                    stay.cardExpMonth(), stay.cardExpYear(), stay.cardBrand());

            PaymentPlanDao planDao = handle.attach(PaymentPlanDao.class);
            int installments = option.numPayments();
            planDao.insertPendingMews(booking.id(), customer.id(), card.id(), stay.totalCents(),
                    installments, stay.frequency().wire(), stay.bookedOn(),
                    option.dueDates().get(installments - 1), stay.depositCents(), feeCents);
            PaymentPlan plan = planDao.findLatestForBooking(booking.id())
                    .orElseThrow(() -> new IllegalStateException("plan insert disappeared"));

            PaymentScheduleDao scheduleDao = handle.attach(PaymentScheduleDao.class);
            scheduleDao.insert(plan.id(), 1, stay.bookedOn(), stay.depositCents(),
                    PaymentScheduleStatus.SCHEDULED.wire(), ScheduleKind.DEPOSIT.wire());
            for (int i = 0; i < installments; i++) {
                long amount = i == installments - 1
                        ? option.finalPaymentAmountCents()
                        : option.perPaymentAmountCents();
                scheduleDao.insert(plan.id(), i + 2, option.dueDates().get(i), amount,
                        PaymentScheduleStatus.SCHEDULED.wire(), ScheduleKind.INSTALLMENT.wire());
            }
            List<PaymentScheduleEntry> rows = scheduleDao.listForPlan(plan.id());
            scheduleDao.markPaidMews(rows.get(0).id(), stay.depositPaymentId(), stay.depositPaidAt());
            planDao.updateStatus(plan.id(), PaymentPlanStatus.ACTIVE.wire());

            if (bookingDao.markAccepted(booking.id(), customer.id()) != 1) {
                throw new IllegalStateException("new booking could not be accepted");
            }
            if (linkingDao.markLinked(stay.linkId(), booking.id(), clock.instant()) != 1) {
                throw new PlanCreationException(Reason.BOOKING_NOT_OPEN, "reservation was already linked");
            }
            booking = bookingDao.findById(booking.id()).orElseThrow();
            plan = planDao.findById(plan.id()).orElseThrow();
            return new Outcome(merchant, customer, booking, plan, scheduleDao.listForPlan(plan.id()),
                    null, PaymentPlanStatus.ACTIVE.wire());
        });
        return finalize(outcome);
    }

    /** Everything Bliss read from Mews about a booking-engine reservation, ready to build a plan on. */
    public record MewsLinkedStay(
            UUID linkId,
            UUID merchantId,
            String reservationId,
            String rateId,
            String categoryId,
            PlanFrequency frequency,
            LocalDate checkin,
            LocalDate checkout,
            Instant startUtc,
            Instant endUtc,
            LocalDate bookedOn,
            String serviceName,
            String serviceDescription,
            long totalCents,
            // The currency totalCents and depositCents are minor units of.
            String currency,
            long depositCents,
            String depositPaymentId,
            Instant depositPaidAt,
            String mewsCustomerId,
            String customerEmail,
            String customerFirstName,
            String customerLastName,
            String mewsCreditCardId,
            String cardLastFour,
            int cardExpMonth,
            int cardExpYear,
            String cardBrand,
            // The rate's booking type and cancellation terms as synced from
            // Mews, and the free cancellation deadline they give this stay.
            // Null when the rate has not been synced; the booking then keeps
            // no snapshot.
            com.bliss.b2b.payments.BookingType bookingType,
            com.bliss.b2b.payments.CancellationTerms cancellationTerms,
            Instant freeCancellationUntil) {
    }

    /** The booking's currency, zone and locale; a booking with no currency cannot take a plan. */
    private static PropertyLocale propertyLocaleOf(Booking booking) {
        if (booking.currency() == null || booking.currency().isBlank()) {
            throw new PlanCreationException(Reason.MERCHANT_NOT_READY,
                    "This booking has no currency. Contact the property to book.");
        }
        return booking.propertyLocale();
    }

    private static String joinName(String first, String last) {
        String f = trimToNull(first);
        String l = trimToNull(last);
        if (f == null) return l;
        return l == null ? f : f + " " + l;
    }

    /**
     * payment_rail written at plan creation. NONE (a property that has not
     * chosen a PMS) charges on the platform exactly as STRIPE does, so it
     * records the same rail: the column describes how the money moved, and for
     * both of those it moved through the Bliss platform account.
     */
    private static String railFor(Merchant merchant) {
        return switch (merchant.pmsType()) {
            case MEWS -> "mews";
            case CLOUDBEDS -> "cloudbeds";
            case STRIPE, NONE -> "stripe";
        };
    }

    private PlanCreationResult finalize(Outcome outcome) {
        // Notifications + webhook only for an activated plan. A pending_card Mews
        // plan has no card and no first charge yet, so it stays silent until
        // card-confirm. Stripe/demo plans are ACTIVE here, so this is a no-op
        // guard for them (behavior unchanged).
        if (outcome.plan().status() == PaymentPlanStatus.ACTIVE) {
            emitPlanStartedWebhook(outcome);
            sendNotifications(outcome);
            // Guest lifecycle emails (idempotent, fire-and-forget).
            notificationService.onPlanActivated(outcome.plan().id());
            // The receipt fires only when the first row is genuinely PAID (on the
            // Mews rail, the upfront charge Mews took at booking). It used to fire on plan status alone, under the
            // comment "plan is active here, so the first schedule row has already
            // been charged/paid". That stopped being true when the Mews rail
            // began inserting an active plan without collecting anything: guests
            // on that rail were emailed a receipt for a charge that was never
            // attempted, while the portal correctly showed nothing paid.
            //
            // Read back from the database rather than trusting outcome.schedule():
            // on the Stripe path that list is fetched BEFORE the charge is
            // recorded and never refreshed, so its first row still says
            // 'scheduled' even after a successful charge. Testing the stale copy
            // would have suppressed the receipt on the one rail that had earned
            // it.
            firstRowIfPaid(outcome.plan().id()).ifPresent(row ->
                    notificationService.onInstallmentPaid(outcome.plan().id(), row.id()));
            notificationService.onPlanCompleted(outcome.plan().id());
        }
        return new PlanCreationResult(
                outcome.plan().id(),
                outcome.booking(),
                outcome.plan(),
                outcome.schedule(),
                outcome.firstChargeIntentId(),
                outcome.firstChargeStatus());
    }

    /**
     * The plan's first schedule row, only when its CURRENT status is PAID.
     *
     * <p>PROCESSING deliberately does not qualify: an in-flight charge has not
     * settled, and Mews sends that receipt from reconciliation once it does.
     * Note there is no equivalent catch-up on the Stripe rail today, so a
     * Stripe first charge that lands in 'processing' rather than 'succeeded'
     * gets no receipt at all. That gap is pre-existing in the sense that
     * nothing ever watched for it; it is called out here because this method is
     * where it becomes observable.
     */
    private java.util.Optional<PaymentScheduleEntry> firstRowIfPaid(UUID planId) {
        List<PaymentScheduleEntry> rows = jdbi.withHandle(h ->
                h.attach(PaymentScheduleDao.class).listForPlan(planId));
        if (rows.isEmpty()) return java.util.Optional.empty();
        PaymentScheduleEntry first = rows.get(0);
        return first.status() == PaymentScheduleStatus.PAID
                ? java.util.Optional.of(first)
                : java.util.Optional.empty();
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
        // The guest plan-confirmation email now goes through the idempotent
        // PlanNotificationService (all rails, once). Only the merchant-facing
        // notice remains here.
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
            // The cart's currency, when the checkout link says; null trusts the
            // property's own currency.
            String currency,
            LocalDate appointmentDate,
            LocalDate checkoutDate,
            String description,
            String customerName,
            String customerFirstName,
            String customerLastName,
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
