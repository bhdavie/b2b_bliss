package com.bliss.b2b.service;

import com.bliss.b2b.domain.Customer;
import com.bliss.b2b.domain.CustomerCard;
import com.bliss.b2b.domain.PaymentPlan;
import com.bliss.b2b.domain.PaymentPlanStatus;
import com.bliss.b2b.domain.PaymentScheduleStatus;
import com.bliss.b2b.integration.StripeConnectResolver;
import com.bliss.b2b.integration.StripePaymentsService;
import com.bliss.b2b.persistence.CustomerCardDao;
import com.bliss.b2b.persistence.CustomerDao;
import com.bliss.b2b.persistence.DueChargeDao.DueInstallment;
import com.bliss.b2b.persistence.PaymentPlanDao;
import com.bliss.b2b.persistence.PaymentScheduleDao;
import com.bliss.b2b.service.InstallmentChargeService.StripeChargeOutcome;
import com.bliss.b2b.service.InstallmentChargeService.StripeInstallmentCharger;
import com.stripe.exception.CardException;
import com.stripe.exception.StripeException;
import com.stripe.model.PaymentIntent;
import java.time.Clock;
import java.time.Instant;
import java.util.Map;
import org.jdbi.v3.core.Jdbi;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Charges a due Stripe-rail installment off-session from the scheduler, so
 * installments after the first fire automatically instead of only via the
 * customer-triggered pay-early button.
 *
 * <p>This reuses the existing charge path verbatim — there is no new state
 * handling here:
 * <ul>
 *   <li>real Stripe: {@link StripePaymentsService#firePaymentOffSession} with the
 *       plan's stored payment method, on the merchant's connected account when
 *       {@link StripeConnectResolver} resolves one (platform key otherwise), the
 *       intent status mapped through {@link PlanCreationService#mapIntentToStatus},
 *       the outcome written with {@link PaymentScheduleDao#recordAttempt} — exactly
 *       like {@link PlanPortalService#payNextInstallment}.
 *   <li>demo (Stripe not configured): {@link PaymentScheduleDao#markPaidNow} with a
 *       synthesized {@code pi_demo_*} id — exactly the existing pay-early demo
 *       behavior ({@code payNextInstallmentDemo}); no new demo logic.
 * </ul>
 *
 * <p>Plan completion is intentionally left to the caller
 * ({@link InstallmentChargeService#runDuePass}), which applies it through the
 * shared ledger so both rails complete identically. Idempotency comes from the
 * due-charge selection ({@code processing}/{@code paid} rows are excluded) plus
 * the Stripe idempotency key (the schedule row id), so a pass that overlaps a
 * pay-early click cannot double-charge a row.
 */
public class JdbiStripeInstallmentCharger implements StripeInstallmentCharger {

    private static final Logger log = LoggerFactory.getLogger(JdbiStripeInstallmentCharger.class);

    private final Jdbi jdbi;
    private final StripePaymentsService stripeService;
    private final StripeConnectResolver stripeConnectResolver;
    private final Clock clock;

    public JdbiStripeInstallmentCharger(
            Jdbi jdbi,
            StripePaymentsService stripeService,
            StripeConnectResolver stripeConnectResolver,
            Clock clock) {
        this.jdbi = jdbi;
        this.stripeService = stripeService;
        this.stripeConnectResolver = stripeConnectResolver;
        this.clock = clock;
    }

    @Override
    public StripeChargeOutcome charge(DueInstallment due) {
        Instant now = Instant.now(clock);

        // Demo mode: no Stripe configured -> settle exactly like pay-early demo
        // (markPaidNow + synthetic intent id). The due-charge query already
        // guarantees the plan is active, matching the Mews branch's trust.
        if (!stripeService.isConfigured()) {
            String demoIntentId = StripeIds.intentIdFor(due.scheduleId());
            jdbi.useHandle(h -> h.attach(PaymentScheduleDao.class)
                    .markPaidNow(due.scheduleId(), demoIntentId, now));
            return StripeChargeOutcome.PAID;
        }

        ChargeContext ctx = jdbi.withHandle(h -> loadContext(h, due));
        if (ctx == null) {
            // Config gap (plan not active, no vaulted card, missing stripe ids):
            // leave the row scheduled for a later pass rather than error out.
            log.warn("Stripe-rail schedule {} not chargeable yet (plan/card not ready); leaving scheduled",
                    due.scheduleId());
            return StripeChargeOutcome.SKIPPED;
        }

        // On the merchant's connected Standard account when it has one, else the
        // platform key. Same resolver the plan-creation charge uses.
        String connectedAccountId = stripeConnectResolver.resolveOrNull(due.merchantId());

        PaymentIntent intent;
        try {
            intent = stripeService.firePaymentOffSession(
                    due.amountCents(),
                    ctx.stripeCustomerId(),
                    ctx.paymentMethodId(),
                    // Idempotency key = schedule row id: a retry on the same row
                    // (or a pass overlapping a pay-early click) reuses the same
                    // PaymentIntent instead of charging twice.
                    due.scheduleId().toString(),
                    Map.of(
                            "bliss_payment_schedule_id", due.scheduleId().toString(),
                            "bliss_payment_plan_id", due.planId().toString(),
                            "bliss_kind", due.kind(),
                            "bliss_source", "scheduled_charge_pass"),
                    connectedAccountId);
        } catch (CardException e) {
            // Off-session decline. Route through the same recordAttempt machinery
            // the other charge paths use: the FAILED row is the retry/attention
            // signal downstream. Not a silent flip, not new state handling.
            String reason = e.getStripeError() != null && e.getStripeError().getMessage() != null
                    ? e.getStripeError().getMessage() : "card declined";
            jdbi.useHandle(h -> h.attach(PaymentScheduleDao.class).recordAttempt(
                    due.planId(), due.sequence(), PaymentScheduleStatus.FAILED.wire(), null, now));
            log.info("Stripe installment {} declined: {}", due.scheduleId(), reason);
            return StripeChargeOutcome.FAILED;
        } catch (StripeException e) {
            // Processor/transport error (not a decline): leave the row untouched so
            // the next pass retries, mirroring the Mews protocol-error handling.
            log.warn("Stripe installment {} charge error (left scheduled): {}",
                    due.scheduleId(), e.getMessage());
            return StripeChargeOutcome.ERROR;
        }

        String wireStatus = intent.getStatus() == null ? "" : intent.getStatus();
        PaymentScheduleStatus mapped = PlanCreationService.mapIntentToStatus(wireStatus);
        jdbi.useHandle(h -> h.attach(PaymentScheduleDao.class).recordAttempt(
                due.planId(), due.sequence(), mapped.wire(), intent.getId(), now));

        return switch (mapped) {
            case PAID -> StripeChargeOutcome.PAID;
            case PROCESSING -> StripeChargeOutcome.PROCESSING;
            case SCHEDULED -> StripeChargeOutcome.REQUIRES_ACTION; // requires_action (off-session 3DS)
            case FAILED, CANCELED -> StripeChargeOutcome.FAILED;
            default -> StripeChargeOutcome.ERROR;
        };
    }

    /** Loads the stripe customer id + default card pm for a due row's plan, or null if not chargeable. */
    private ChargeContext loadContext(org.jdbi.v3.core.Handle h, DueInstallment due) {
        PaymentPlan plan = h.attach(PaymentPlanDao.class).findById(due.planId()).orElse(null);
        if (plan == null || plan.status() != PaymentPlanStatus.ACTIVE) {
            return null;
        }
        Customer customer = h.attach(CustomerDao.class).findById(plan.customerId()).orElse(null);
        if (customer == null || isBlank(customer.stripeCustomerId())) {
            return null;
        }
        CustomerCard card = h.attach(CustomerCardDao.class)
                .findDefaultForCustomer(plan.customerId()).orElse(null);
        if (card == null || isBlank(card.stripePaymentMethodId())) {
            return null;
        }
        return new ChargeContext(customer.stripeCustomerId(), card.stripePaymentMethodId());
    }

    private static boolean isBlank(String s) {
        return s == null || s.isBlank();
    }

    private record ChargeContext(String stripeCustomerId, String paymentMethodId) {
    }
}
