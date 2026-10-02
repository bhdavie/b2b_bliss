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
import com.bliss.b2b.integration.StripeConnectResolver;
import com.bliss.b2b.integration.StripePaymentsService;
import com.bliss.b2b.integration.StripePaymentsService.CardSummary;
import com.bliss.b2b.integration.pms.PmsAdapterException;
import com.bliss.b2b.integration.pms.PmsChargeResult;
import com.bliss.b2b.payments.PropertyLocale;
import com.bliss.b2b.persistence.BookingDao;
import com.bliss.b2b.persistence.CustomerCardDao;
import com.bliss.b2b.persistence.CustomerDao;
import com.bliss.b2b.persistence.MerchantDao;
import com.bliss.b2b.persistence.PaymentPlanDao;
import com.bliss.b2b.persistence.PaymentPlanDao.ChargeRoute;
import com.bliss.b2b.persistence.PaymentScheduleDao;
import com.bliss.b2b.service.InstallmentChargeService.ChargeContext;
import com.bliss.b2b.service.InstallmentChargeService.ChargeContextResolver;
import com.stripe.exception.CardException;
import com.stripe.exception.StripeException;
import com.stripe.model.PaymentIntent;
import com.stripe.model.PaymentMethod;
import com.stripe.model.SetupIntent;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.Collectors;
import org.jdbi.v3.core.Jdbi;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Backs the customer plan portal at {@code /plan/{bookingToken}}. Read path
 * bundles every row the portal renders; write paths advance the schedule
 * (pay early) or vault a replacement card.
 *
 * <p>Guest payments (pay early, pay off) charge through the plan's own rail:
 * a Stripe plan through a Stripe PaymentIntent, a Mews plan through the
 * property's Mews {@code creditCards/charge} on the card Mews holds. Demo
 * plans (Stripe not configured, or a demo Mews property's synthetic card)
 * persist the same shape with synthesized {@code *_demo_*} ids.
 */
public class PlanPortalService {

    private static final Logger log = LoggerFactory.getLogger(PlanPortalService.class);

    private final Jdbi jdbi;
    private final StripePaymentsService stripeService;
    private final StripeConnectResolver stripeConnectResolver;
    private final ChargeContextResolver mewsResolver;
    private final CancellationService cancellationService;
    private final PlanNotificationService notificationService;
    private final Clock clock;

    public PlanPortalService(
            Jdbi jdbi,
            StripePaymentsService stripeService,
            StripeConnectResolver stripeConnectResolver,
            ChargeContextResolver mewsResolver,
            CancellationService cancellationService,
            PlanNotificationService notificationService,
            Clock clock) {
        this.jdbi = jdbi;
        this.stripeService = stripeService;
        this.stripeConnectResolver = stripeConnectResolver;
        this.mewsResolver = mewsResolver;
        this.cancellationService = cancellationService;
        this.notificationService = notificationService;
        this.clock = clock;
    }

    /**
     * Customer-initiated cancellation from the plan portal. Resolves the plan
     * by booking token and routes through the single canonical
     * {@link CancellationService#cancel} path (marks the plan canceled and
     * cancels the remaining schedule rows). Money movement is computed and
     * logged there but not executed. Throws {@link PortalException} when the
     * plan is absent or already in a terminal state.
     */
    public CancellationService.CancellationOutcome cancelPlan(String bookingToken) {
        PaymentPlan plan = jdbi.withHandle(handle ->
                resolveOrThrow(handle, bookingToken).plan());
        if (plan.status() != PaymentPlanStatus.ACTIVE) {
            throw new PortalException(
                    PortalErrorCode.PLAN_NOT_ACTIVE, "plan is not active");
        }
        return cancellationService.cancel(plan, Instant.now(clock), "customer_initiated");
    }

    public Optional<PortalSnapshot> getPortal(String bookingToken) {
        return jdbi.withHandle(handle -> {
            Booking booking = handle.attach(BookingDao.class).findByToken(bookingToken).orElse(null);
            if (booking == null) return Optional.<PortalSnapshot>empty();
            Merchant merchant = handle.attach(MerchantDao.class).findById(booking.merchantId()).orElse(null);
            if (merchant == null) return Optional.<PortalSnapshot>empty();
            // Read path: resolve the latest plan regardless of status so a
            // cancelled plan still renders (as cancelled) instead of 404'ing.
            PaymentPlan plan = handle.attach(PaymentPlanDao.class).findLatestForBooking(booking.id()).orElse(null);
            if (plan == null) return Optional.<PortalSnapshot>empty();
            List<PaymentScheduleEntry> schedule = handle.attach(PaymentScheduleDao.class).listForPlan(plan.id());
            Customer customer = handle.attach(CustomerDao.class).findById(plan.customerId()).orElse(null);
            CustomerCard card = handle.attach(CustomerCardDao.class)
                    .findDefaultForCustomer(plan.customerId()).orElse(null);
            // Progress from each row's own status (see PlanProgress).
            PlanProgress.Snapshot progress = PlanProgress.asOf(
                    schedule.stream()
                            .map(e -> new PlanProgress.Row(
                                    e.dueDate(), e.amountCents(), e.status().wire()))
                            .toList(),
                    plan.totalAmountCents() + plan.processingFeeCents(),
                    PropertyLocale.today(clock, booking.timeZone()),
                    plan.status().wire());
            // What cancelling now would do, so the guest sees it before deciding.
            CancellationService.Assessment cancellation =
                    cancellationService != null && plan.status() == PaymentPlanStatus.ACTIVE
                            ? CancellationService.assess(plan, booking,
                                    handle.attach(com.bliss.b2b.persistence.MerchantPlanRulesDao.class)
                                            .findByMerchantId(merchant.id())
                                            .orElse(com.bliss.b2b.payments.MerchantPlanRules.DEFAULTS),
                                    schedule, Instant.now(clock))
                            : null;
            return Optional.of(new PortalSnapshot(
                    merchant, booking, plan, schedule, customer, card,
                    plan.processingFeeCents(), progress, cancellation));
        });
    }

    /**
     * Customer-initiated pay-early on the next {@code scheduled} installment,
     * charged through the plan's rail (see {@link #routeOf}).
     */
    public PayResult payNextInstallment(String bookingToken) {
        refuseIfPaused(bookingToken);
        return notifyPaid(switch (routeFor(bookingToken)) {
            case STRIPE -> payNextInstallmentStripe(bookingToken);
            case MEWS -> payNextInstallmentMews(bookingToken);
            case DEMO -> payNextInstallmentDemo(bookingToken);
        });
    }

    /** Stripe rail: the same off-session charge path the deposit went through. */
    private Paid payNextInstallmentStripe(String bookingToken) {
        return jdbi.inTransaction(handle -> {
            Lookup look = resolveOrThrow(handle, bookingToken);
            if (look.plan.status() != PaymentPlanStatus.ACTIVE) {
                throw new PortalException(PortalErrorCode.PLAN_NOT_ACTIVE,
                        "plan is not active (status=" + look.plan.status().wire() + ")");
            }
            // Same lock as the scheduled pass and the Mews paths, so no two of
            // them can charge one installment.
            handle.attach(PaymentPlanDao.class).lockForUpdate(look.plan.id());
            PaymentScheduleDao scheduleDao = handle.attach(PaymentScheduleDao.class);
            PaymentScheduleEntry next = scheduleDao.findNextScheduled(look.plan.id()).orElseThrow(
                    () -> new PortalException(PortalErrorCode.NO_NEXT_INSTALLMENT,
                            "no scheduled installment remaining"));

            CustomerCard card = handle.attach(CustomerCardDao.class)
                    .findDefaultForCustomer(look.plan.customerId())
                    .orElseThrow(() -> new PortalException(PortalErrorCode.NO_CARD_ON_FILE,
                            "no card on file for this plan"));

            StripePaymentsService.Destination destination = stripeConnectResolver.destinationFor(
                    handle, look.booking.merchantId(), look.booking.id(), look.booking.payoutMode());
            PaymentIntent intent;
            try {
                intent = stripeService.firePaymentOffSession(
                        next.amountCents(),
                        look.booking.currency(),
                        look.customer.stripeCustomerId(),
                        card.stripePaymentMethodId(),
                        next.id().toString(),
                        Map.of(
                                "bliss_payment_schedule_id", next.id().toString(),
                                "bliss_payment_plan_id", look.plan.id().toString(),
                                "bliss_booking_id", look.booking.id().toString(),
                                "bliss_kind", next.kind().wire(),
                                "bliss_source", "portal_pay_early"),
                        destination,
                        // Charging the card already on file, no new card entry:
                        // same off-session shape as the scheduled pass.
                        StripePaymentsService.SessionMode.OFF_SESSION);
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
            return new Paid(new PayResult(intent.getId(), wireStatus), look.plan.id(),
                    newStatus == PaymentScheduleStatus.PAID ? List.of(next.id()) : List.of());
        });
    }

    /**
     * Mews rail: charges the card Mews holds for this plan, against the stay's
     * reservation, through the property's own Mews connection. Charged marks
     * the row paid; a charge Mews has not settled yet leaves the row
     * processing with its Mews payment id, for the reconciliation pass to
     * settle exactly as it does for scheduled charges. A decline writes
     * nothing, so the installment stays scheduled.
     */
    private Paid payNextInstallmentMews(String bookingToken) {
        return jdbi.inTransaction(handle -> {
            Lookup look = resolveOrThrow(handle, bookingToken);
            if (look.plan.status() != PaymentPlanStatus.ACTIVE) {
                throw new PortalException(PortalErrorCode.PLAN_NOT_ACTIVE,
                        "plan is not active (status=" + look.plan.status().wire() + ")");
            }
            handle.attach(PaymentPlanDao.class).lockForUpdate(look.plan.id());
            PaymentScheduleDao scheduleDao = handle.attach(PaymentScheduleDao.class);
            PaymentScheduleEntry next = scheduleDao.findNextScheduled(look.plan.id()).orElseThrow(
                    () -> new PortalException(PortalErrorCode.NO_NEXT_INSTALLMENT,
                            "no scheduled installment remaining"));

            MewsCharge charge = chargeMews(handle, look, next.amountCents(),
                    "Bliss pay early, installment seq " + next.sequence());
            Instant now = Instant.now(clock);
            if (charge.status() == PaymentScheduleStatus.PAID) {
                scheduleDao.markPaidMews(next.id(), charge.paymentId(), now);
                maybeCompletePlan(handle, look.plan, next);
                return new Paid(new PayResult(charge.paymentId(), "succeeded"), look.plan.id(),
                        List.of(next.id()));
            }
            scheduleDao.recordMewsProcessing(next.id(), charge.paymentId(),
                    "mews state=" + charge.rawState(), now);
            // Reconciliation sends the receipt once Mews settles it.
            return new Paid(new PayResult(charge.paymentId(), "processing"), look.plan.id(), List.of());
        });
    }

    private Paid payNextInstallmentDemo(String bookingToken) {
        return jdbi.inTransaction(handle -> {
            Lookup look = resolveOrThrow(handle, bookingToken);
            if (look.plan.status() != PaymentPlanStatus.ACTIVE) {
                throw new PortalException(PortalErrorCode.PLAN_NOT_ACTIVE,
                        "plan is not active (status=" + look.plan.status().wire() + ")");
            }
            handle.attach(PaymentPlanDao.class).lockForUpdate(look.plan.id());
            PaymentScheduleDao scheduleDao = handle.attach(PaymentScheduleDao.class);
            PaymentScheduleEntry next = scheduleDao.findNextScheduled(look.plan.id()).orElseThrow(
                    () -> new PortalException(PortalErrorCode.NO_NEXT_INSTALLMENT,
                            "no scheduled installment remaining"));
            String demoIntentId = StripeIds.intentIdFor(next.id());
            scheduleDao.markPaidNow(next.id(), demoIntentId, Instant.now(clock));
            maybeCompletePlan(handle, look.plan, next);
            return new Paid(new PayResult(demoIntentId, "succeeded"), look.plan.id(), List.of(next.id()));
        });
    }

    /**
     * Customer-initiated payoff of the whole outstanding balance from the plan
     * portal. Distinct from {@link #payNextInstallment}, which settles exactly
     * one row: this sums every unsettled row and charges them together.
     *
     * <p>ALL-OR-NOTHING. One PaymentIntent covers the whole balance, and the
     * rows are marked paid only after it succeeds, inside the same transaction.
     * A decline marks nothing and leaves the plan exactly as it was — there is
     * no state in which some rows settled and others did not.
     *
     * <p>NO FEE RECALCULATION. The processing fee already rode on the deposit,
     * so each remaining row is charged at the amount it already carries and the
     * guest pays the same total either way. The charge is the arithmetic sum of
     * those rows, never a recomputed balance.
     *
     * <p>A row already {@code processing} with the rail blocks the payoff: its
     * outcome is unknown, and charging over it could take the guest's money
     * twice for the same installment.
     */
    public PayResult payRemainingBalance(String bookingToken) {
        refuseIfPaused(bookingToken);
        return notifyPaid(switch (routeFor(bookingToken)) {
            case STRIPE -> payRemainingBalanceStripe(bookingToken);
            case MEWS -> payRemainingBalanceMews(bookingToken);
            case DEMO -> payRemainingBalanceDemo(bookingToken);
        });
    }

    /** A guest payment's result plus the rows it settled, for the emails sent after commit. */
    private record Paid(PayResult result, UUID planId, List<UUID> settledRowIds) {}

    /**
     * Receipts once the payment has committed. A pay off's rows share one
     * charge, and the notification service turns them into a single receipt
     * for the full amount. Only rows this call settled are passed, so no
     * earlier payment is receipted late.
     */
    private PayResult notifyPaid(Paid paid) {
        for (UUID rowId : paid.settledRowIds()) {
            notificationService.onInstallmentPaid(paid.planId(), rowId);
        }
        if (!paid.settledRowIds().isEmpty()) {
            notificationService.onPlanCompleted(paid.planId());
        }
        return paid.result();
    }

    private static List<UUID> ids(List<PaymentScheduleEntry> rows) {
        return rows.stream().map(PaymentScheduleEntry::id).toList();
    }

    private Paid payRemainingBalanceStripe(String bookingToken) {
        return jdbi.inTransaction(handle -> {
            Lookup look = resolveOrThrow(handle, bookingToken);
            if (look.plan.status() != PaymentPlanStatus.ACTIVE) {
                throw new PortalException(PortalErrorCode.PLAN_NOT_ACTIVE,
                        "plan is not active (status=" + look.plan.status().wire() + ")");
            }
            // Same lock as the scheduled pass and the Mews paths, so no two of
            // them can charge one installment.
            handle.attach(PaymentPlanDao.class).lockForUpdate(look.plan.id());
            PaymentScheduleDao scheduleDao = handle.attach(PaymentScheduleDao.class);
            List<PaymentScheduleEntry> unsettled = requirePayableBalance(
                    scheduleDao.listUnsettledForPlan(look.plan.id()));
            long amountCents = sumAmounts(unsettled);

            CustomerCard card = handle.attach(CustomerCardDao.class)
                    .findDefaultForCustomer(look.plan.customerId())
                    .orElseThrow(() -> new PortalException(PortalErrorCode.NO_CARD_ON_FILE,
                            "no card on file for this plan"));

            StripePaymentsService.Destination destination = stripeConnectResolver.destinationFor(
                    handle, look.booking.merchantId(), look.booking.id(), look.booking.payoutMode());
            PaymentIntent intent;
            try {
                intent = stripeService.firePaymentOffSession(
                        amountCents,
                        look.booking.currency(),
                        look.customer.stripeCustomerId(),
                        card.stripePaymentMethodId(),
                        // The row id is no longer a unique key for this charge —
                        // it covers several. Key on the plan plus the exact set
                        // of rows, so a double submit is idempotent while a
                        // later payoff of a different set is not blocked.
                        payoffIdempotencyKey(look.plan.id(), unsettled),
                        Map.of(
                                "bliss_payment_plan_id", look.plan.id().toString(),
                                "bliss_booking_id", look.booking.id().toString(),
                                "bliss_payment_schedule_ids", joinIds(unsettled),
                                "bliss_rows_settled", String.valueOf(unsettled.size()),
                                "bliss_source", "portal_pay_remaining"),
                        destination,
                        StripePaymentsService.SessionMode.OFF_SESSION);
            } catch (CardException e) {
                throw new PortalException(PortalErrorCode.CARD_DECLINED,
                        e.getStripeError() != null && e.getStripeError().getMessage() != null
                                ? e.getStripeError().getMessage()
                                : "your card was declined");
            } catch (StripeException e) {
                log.warn("Stripe error in pay-remaining: {}", e.getMessage());
                throw new PortalException(PortalErrorCode.STRIPE_ERROR, "payment processor error");
            }

            String wireStatus = intent.getStatus() == null ? "" : intent.getStatus();
            PaymentScheduleStatus newStatus = PlanCreationService.mapIntentToStatus(wireStatus);
            // Nothing is written before this point, so throwing here rolls the
            // transaction back with every row untouched.
            if (newStatus != PaymentScheduleStatus.PAID) {
                if (newStatus == PaymentScheduleStatus.SCHEDULED) {
                    throw new PortalException(PortalErrorCode.CARD_REQUIRES_ACTION,
                            "card requires authentication; please use a different card");
                }
                throw new PortalException(PortalErrorCode.CARD_DECLINED,
                        "payment was not completed (status=" + wireStatus + ")");
            }
            settleAll(handle, look.plan, unsettled, intent.getId());
            log.info("Plan {} paid off early: {} rows, {}c, intent {}",
                    look.plan.id(), unsettled.size(), amountCents, intent.getId());
            return new Paid(new PayResult(intent.getId(), wireStatus), look.plan.id(), ids(unsettled));
        });
    }

    /**
     * Mews rail payoff: one Mews charge for the sum of the unsettled rows, the
     * same all-or-nothing shape as the Stripe payoff. Charged marks every row
     * paid under the one Mews payment id; unsettled leaves every row
     * processing under it, and the reconciliation pass settles them together.
     * A decline writes nothing.
     */
    private Paid payRemainingBalanceMews(String bookingToken) {
        return jdbi.inTransaction(handle -> {
            Lookup look = resolveOrThrow(handle, bookingToken);
            if (look.plan.status() != PaymentPlanStatus.ACTIVE) {
                throw new PortalException(PortalErrorCode.PLAN_NOT_ACTIVE,
                        "plan is not active (status=" + look.plan.status().wire() + ")");
            }
            handle.attach(PaymentPlanDao.class).lockForUpdate(look.plan.id());
            PaymentScheduleDao scheduleDao = handle.attach(PaymentScheduleDao.class);
            List<PaymentScheduleEntry> unsettled = requirePayableBalance(
                    scheduleDao.listUnsettledForPlan(look.plan.id()));
            long amountCents = sumAmounts(unsettled);

            MewsCharge charge = chargeMews(handle, look, amountCents,
                    "Bliss pay off, " + unsettled.size() + " payments");
            Instant now = Instant.now(clock);
            if (charge.status() == PaymentScheduleStatus.PAID) {
                for (PaymentScheduleEntry row : unsettled) {
                    scheduleDao.markPaidMews(row.id(), charge.paymentId(), now);
                }
                maybeCompletePlan(handle, look.plan, unsettled.get(unsettled.size() - 1));
                log.info("Plan {} paid off early on Mews: {} rows, {} minor units, payment {}",
                        look.plan.id(), unsettled.size(), amountCents, charge.paymentId());
                return new Paid(new PayResult(charge.paymentId(), "succeeded"), look.plan.id(),
                        ids(unsettled));
            }
            for (PaymentScheduleEntry row : unsettled) {
                scheduleDao.recordMewsProcessing(row.id(), charge.paymentId(),
                        "mews payoff state=" + charge.rawState(), now);
            }
            // Reconciliation sends the one receipt once Mews settles it.
            return new Paid(new PayResult(charge.paymentId(), "processing"), look.plan.id(), List.of());
        });
    }

    private Paid payRemainingBalanceDemo(String bookingToken) {
        return jdbi.inTransaction(handle -> {
            Lookup look = resolveOrThrow(handle, bookingToken);
            if (look.plan.status() != PaymentPlanStatus.ACTIVE) {
                throw new PortalException(PortalErrorCode.PLAN_NOT_ACTIVE,
                        "plan is not active (status=" + look.plan.status().wire() + ")");
            }
            handle.attach(PaymentPlanDao.class).lockForUpdate(look.plan.id());
            PaymentScheduleDao scheduleDao = handle.attach(PaymentScheduleDao.class);
            List<PaymentScheduleEntry> unsettled = requirePayableBalance(
                    scheduleDao.listUnsettledForPlan(look.plan.id()));
            // One synthesized intent id for the whole payoff, derived from the
            // first row so it stays traceable in raw tables, and written to
            // every row it settled — the same shape the real branch leaves.
            String demoIntentId = StripeIds.intentIdFor(unsettled.get(0).id());
            settleAll(handle, look.plan, unsettled, demoIntentId);
            log.info("Plan {} paid off early (demo): {} rows, {}c, intent {}",
                    look.plan.id(), unsettled.size(), sumAmounts(unsettled), demoIntentId);
            return new Paid(new PayResult(demoIntentId, "succeeded"), look.plan.id(), ids(unsettled));
        });
    }

    /** Rejects an empty or in-flight balance before any charge is attempted. */
    private static List<PaymentScheduleEntry> requirePayableBalance(
            List<PaymentScheduleEntry> unsettled) {
        if (unsettled.isEmpty()) {
            throw new PortalException(PortalErrorCode.NO_NEXT_INSTALLMENT,
                    "no outstanding balance remaining");
        }
        boolean anyInFlight = unsettled.stream()
                .anyMatch(e -> e.status() == PaymentScheduleStatus.PROCESSING);
        if (anyInFlight) {
            throw new PortalException(PortalErrorCode.PAYMENT_IN_FLIGHT,
                    "a payment on this plan is still processing; try again shortly");
        }
        return unsettled;
    }

    private static long sumAmounts(List<PaymentScheduleEntry> rows) {
        return rows.stream().mapToLong(PaymentScheduleEntry::amountCents).sum();
    }

    private static String joinIds(List<PaymentScheduleEntry> rows) {
        return rows.stream().map(e -> e.id().toString()).collect(Collectors.joining(","));
    }

    /**
     * Idempotency key for a payoff. Includes the row ids, so re-submitting the
     * same payoff is deduplicated by Stripe while a genuinely different payoff
     * (a later one, over a different set of rows) is not swallowed.
     */
    private static String payoffIdempotencyKey(UUID planId, List<PaymentScheduleEntry> rows) {
        return "payoff:" + planId + ":" + joinIds(rows);
    }

    /** Marks every settled row paid under one intent id, then completes the plan. */
    private void settleAll(
            org.jdbi.v3.core.Handle handle,
            PaymentPlan plan,
            List<PaymentScheduleEntry> rows,
            String intentId) {
        PaymentScheduleDao scheduleDao = handle.attach(PaymentScheduleDao.class);
        Instant now = Instant.now(clock);
        for (PaymentScheduleEntry row : rows) {
            scheduleDao.markPaidNow(row.id(), intentId, now);
        }
        maybeCompletePlan(handle, plan, rows.get(rows.size() - 1));
    }

    /**
     * Attach a freshly-vaulted PaymentMethod to the customer and mark it as
     * the new default. Existing default is flagged non-default first so the
     * portal's card-on-file lookup picks the new one. Demo mode skips the
     * Stripe attach and just inserts the row.
     */
    public ReplaceCardResult replacePaymentMethod(
            String bookingToken, String newPaymentMethodId, PlanCreationService.DemoCard demoCard) {
        if (!stripeLiveFor(bookingToken)) {
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
        if (!stripeLiveFor(bookingToken)) {
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

    /**
     * While a card dispute pauses the plan, the guest can't pay early or pay
     * off either: the card is being disputed, and taking more from it adds to
     * the exposure. The guest is pointed to the property.
     */
    private void refuseIfPaused(String bookingToken) {
        boolean paused = jdbi.withHandle(handle -> {
            Lookup look = resolveOrThrow(handle, bookingToken);
            return handle.attach(com.bliss.b2b.persistence.PlanDisputeDao.class).paymentsPaused(look.plan.id());
        });
        if (paused) {
            throw new PortalException(PortalErrorCode.PAYMENTS_PAUSED,
                    "Payments on this plan are paused. Please contact the property.");
        }
    }

    /** Where a guest payment on this plan goes. */
    enum Route { STRIPE, MEWS, DEMO }

    private Route routeFor(String bookingToken) {
        return jdbi.withHandle(handle -> {
            Lookup look = resolveOrThrow(handle, bookingToken);
            ChargeRoute route = handle.attach(PaymentPlanDao.class).chargeRoute(look.plan.id())
                    .orElseThrow(() -> new PortalException(PortalErrorCode.NOT_FOUND, "plan not found"));
            return routeOf(route, stripeService.isLiveFor(
                    handle.attach(MerchantDao.class).findById(look.booking.merchantId()).orElse(null)));
        });
    }

    /** Whether Stripe is real for this plan's property; demo properties never are. */
    private boolean stripeLiveFor(String bookingToken) {
        return jdbi.withHandle(handle -> {
            Lookup look = resolveOrThrow(handle, bookingToken);
            return stripeService.isLiveFor(
                    handle.attach(MerchantDao.class).findById(look.booking.merchantId()).orElse(null));
        });
    }

    /**
     * The plan's rail decides, never whether Stripe happens to be configured:
     * a Mews plan charged through Stripe would charge a placeholder card id on
     * the wrong processor.
     *
     * <ul>
     *   <li>{@code mews} with a Mews card: the property's Mews. With the
     *       synthetic {@code pm_demo_} card a listed demo Mews property gets,
     *       demo. With neither, there is nothing to charge.
     *   <li>{@code stripe}: Stripe, or demo while Stripe is not configured.
     *   <li>anything else (Cloudbeds, which has no card capture yet): refused.
     * </ul>
     */
    static Route routeOf(ChargeRoute route, boolean stripeConfigured) {
        String rail = route.paymentRail() == null ? "" : route.paymentRail();
        return switch (rail) {
            case "mews" -> {
                if (notBlank(route.mewsCreditCardId()) && notBlank(route.mewsCustomerId())) {
                    yield Route.MEWS;
                }
                if (route.cardKey() != null && route.cardKey().startsWith("pm_demo_")) {
                    yield Route.DEMO;
                }
                throw new PortalException(PortalErrorCode.NO_CARD_ON_FILE,
                        "no card the property can charge is on file for this plan");
            }
            case "stripe" -> stripeConfigured ? Route.STRIPE : Route.DEMO;
            default -> throw new PortalException(PortalErrorCode.RAIL_UNAVAILABLE,
                    "paying early is not available for this plan yet");
        };
    }

    /**
     * One Mews charge for {@code amountMinorUnits} of the booking's currency,
     * after the same checks the scheduled pass makes: the property's own Mews
     * connection, the same currency, and a stay still on in Mews. Returns the
     * outcome as a schedule status (PAID or PROCESSING); a decline throws
     * CARD_DECLINED before anything is written.
     */
    private MewsCharge chargeMews(
            org.jdbi.v3.core.Handle handle, Lookup look, long amountMinorUnits, String notes) {
        ChargeRoute route = handle.attach(PaymentPlanDao.class).chargeRoute(look.plan.id())
                .orElseThrow(() -> new PortalException(PortalErrorCode.NOT_FOUND, "plan not found"));
        ChargeContext ctx = mewsResolver.resolve(look.booking.merchantId())
                .orElseThrow(() -> new PortalException(PortalErrorCode.RAIL_UNAVAILABLE,
                        "the property cannot take payments right now; please try again later"));
        String currency = look.booking.currency();
        if (currency == null || !currency.equalsIgnoreCase(ctx.currency())) {
            log.warn("Plan {} is in {} but its property now charges in {}; pay early refused",
                    look.plan.id(), currency, ctx.currency());
            throw new PortalException(PortalErrorCode.RAIL_UNAVAILABLE,
                    "the property cannot take this payment right now; please contact them");
        }
        String reservationId = route.mewsReservationId();
        try {
            if (reservationId != null) {
                Optional<String> state = ctx.adapter().getReservationState(reservationId);
                if (state.isEmpty()
                        || !InstallmentChargeService.CHARGEABLE_RESERVATION_STATES.contains(state.get())) {
                    throw new PortalException(PortalErrorCode.PLAN_NOT_ACTIVE,
                            "your stay is not confirmed with the property, so nothing was charged");
                }
            }
            PmsChargeResult result = ctx.adapter().chargeStoredCard(
                    route.mewsCustomerId(), route.mewsCreditCardId(), amountMinorUnits,
                    currency, reservationId, notes);
            PaymentScheduleStatus mapped = InstallmentChargeService.mapChargeStatus(result.status());
            if (mapped == PaymentScheduleStatus.FAILED) {
                log.info("Mews pay early on plan {} declined (state {})", look.plan.id(), result.rawState());
                throw new PortalException(PortalErrorCode.CARD_DECLINED, "your card was declined");
            }
            return new MewsCharge(result.paymentId(), mapped, result.rawState());
        } catch (PmsAdapterException e) {
            log.warn("Mews error in pay early on plan {}: {}", look.plan.id(), e.getMessage());
            throw new PortalException(PortalErrorCode.PMS_ERROR, "payment processor error");
        }
    }

    private record MewsCharge(String paymentId, PaymentScheduleStatus status, String rawState) {}

    private static boolean notBlank(String s) {
        return s != null && !s.isBlank();
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
            long processingFeeCents,
            PlanProgress.Snapshot progress,
            // What cancelling now would do; null once the plan is no longer active.
            CancellationService.Assessment cancellation
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
        /** A charge on this plan is already in flight with the rail. */
        PAYMENT_IN_FLIGHT,
        /** The plan's rail cannot take a guest payment now (no connection, currency changed, unsupported rail). */
        RAIL_UNAVAILABLE,
        /** The PMS failed for a reason other than the card (transport, 5xx). */
        PMS_ERROR,
        /** A card dispute has paused the plan's payments. */
        PAYMENTS_PAUSED,
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
