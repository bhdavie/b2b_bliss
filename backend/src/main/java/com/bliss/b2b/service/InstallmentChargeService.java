package com.bliss.b2b.service;

import com.bliss.b2b.domain.PaymentPlan;
import com.bliss.b2b.domain.PaymentPlanStatus;
import com.bliss.b2b.domain.PaymentScheduleStatus;
import com.bliss.b2b.domain.ScheduleKind;
import com.bliss.b2b.integration.pms.PmsAdapter;
import com.bliss.b2b.integration.pms.PmsAdapterException;
import com.bliss.b2b.integration.pms.PmsChargeResult;
import com.bliss.b2b.integration.pms.PmsChargeStatus;
import com.bliss.b2b.persistence.DueChargeDao;
import com.bliss.b2b.persistence.DueChargeDao.DueInstallment;
import com.bliss.b2b.persistence.PaymentPlanDao;
import com.bliss.b2b.persistence.PaymentScheduleDao;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.jdbi.v3.core.Jdbi;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * The installment charge pass: the scheduler step that finds due installments
 * and charges the ones on the Mews rail through the {@link PmsAdapter}. This is
 * the single place the rail branch lives.
 *
 * <p><b>Stripe is untouched.</b> Stripe-rail installments are skipped here and
 * left to the existing (unchanged) Stripe paths; this pass never calls Stripe
 * code. Wiring the pass onto a timer is deliberately out of scope — it is
 * invoked directly by the demo/test for now.
 *
 * <p>Persistence sits behind {@link Ledger} so the routing and status mapping
 * can be unit-tested with a fake, without a database. {@link JdbiLedger} is the
 * real implementation used by the live demo (and, later, the app).
 */
public class InstallmentChargeService {

    private static final Logger log = LoggerFactory.getLogger(InstallmentChargeService.class);

    static final String RAIL_STRIPE = "stripe";
    static final String RAIL_MEWS = "mews";

    private final Ledger ledger;
    private final ChargeContextResolver resolver;
    /** Charges due Stripe-rail rows. Null (e.g. in unit tests) preserves the original skip. */
    private final StripeInstallmentCharger stripeCharger;
    private final Clock clock;

    public InstallmentChargeService(
            Ledger ledger, ChargeContextResolver resolver, Clock clock) {
        this(ledger, resolver, null, clock);
    }

    public InstallmentChargeService(
            Ledger ledger, ChargeContextResolver resolver,
            StripeInstallmentCharger stripeCharger, Clock clock) {
        this.ledger = ledger;
        this.resolver = resolver;
        this.stripeCharger = stripeCharger;
        this.clock = clock;
    }

    /**
     * Charges every Mews-rail installment due on or before {@code asOf}. Stripe
     * rows are counted and skipped. Returns a tally of what happened.
     */
    public PassResult runDuePass(LocalDate asOf) {
        List<DueInstallment> due = ledger.findDue(asOf);
        int charged = 0, processing = 0, failed = 0, skippedStripe = 0, errors = 0;

        for (DueInstallment d : due) {
            String rail = d.paymentRail();
            if (RAIL_STRIPE.equalsIgnoreCase(rail)) {
                if (stripeCharger == null) {
                    // No Stripe charger wired (e.g. unit tests): keep the original
                    // skip so a Stripe row is never charged without one present.
                    skippedStripe++;
                    continue;
                }
                // Charge the due Stripe row off-session via the same path the
                // inline first charge and pay-early use; completion is applied
                // here through the shared ledger, exactly like the Mews branch.
                switch (stripeCharger.charge(d)) {
                    case PAID -> {
                        ledger.completePlanIfDone(d.planId(), ScheduleKind.fromWire(d.kind()));
                        charged++;
                    }
                    case PROCESSING -> processing++;
                    case FAILED -> failed++;
                    case SKIPPED -> skippedStripe++;
                    case REQUIRES_ACTION, ERROR -> errors++;
                }
                continue;
            }
            if (!RAIL_MEWS.equalsIgnoreCase(rail)) {
                log.warn("Unknown payment_rail '{}' on schedule {}; skipping", rail, d.scheduleId());
                errors++;
                continue;
            }
            if (isBlank(d.mewsCustomerId()) || isBlank(d.mewsCreditCardId())) {
                // Config gap, not a decline: leave the row scheduled so it
                // charges once a card is vaulted. Do not consume a retry.
                log.warn("Mews-rail schedule {} has no vaulted card; leaving scheduled", d.scheduleId());
                errors++;
                continue;
            }
            // Resolve the property's OWN Mews adapter + currency. A Mews-rail
            // plan whose property has no validated connection is a config gap,
            // not a decline: leave it scheduled, do not charge on someone else's
            // credentials.
            Optional<ChargeContext> ctxMaybe = resolver.resolve(d.merchantId());
            if (ctxMaybe.isEmpty()) {
                log.warn("Mews-rail schedule {} has no property connection (merchant {}); leaving scheduled",
                        d.scheduleId(), d.merchantId());
                errors++;
                continue;
            }
            ChargeContext ctx = ctxMaybe.get();

            Instant now = Instant.now(clock);
            try {
                PmsChargeResult result = ctx.adapter().chargeStoredCard(
                        d.mewsCustomerId(),
                        d.mewsCreditCardId(),
                        d.amountCents(),
                        ctx.currency(),
                        null,
                        "Bliss installment seq " + d.sequence());
                PaymentScheduleStatus mapped = mapChargeStatus(result.status());
                switch (mapped) {
                    case PAID -> {
                        ledger.markPaid(d.scheduleId(), result.paymentId(), now);
                        ledger.completePlanIfDone(d.planId(), ScheduleKind.fromWire(d.kind()));
                        charged++;
                        log.info("Mews installment {} charged (payment {})",
                                d.scheduleId(), result.paymentId());
                    }
                    case PROCESSING -> {
                        ledger.markProcessing(d.scheduleId(), result.paymentId(),
                                "mews state=" + result.rawState(), now);
                        processing++;
                        log.info("Mews installment {} in flight (payment {}, state {})",
                                d.scheduleId(), result.paymentId(), result.rawState());
                    }
                    case FAILED -> {
                        ledger.markFailed(d.scheduleId(),
                                "mews charge declined (state=" + result.rawState() + ")", now);
                        failed++;
                        log.info("Mews installment {} declined (state {})",
                                d.scheduleId(), result.rawState());
                    }
                    default -> errors++;
                }
            } catch (PmsAdapterException e) {
                // Protocol/transport error: the charge did not settle. Leave the
                // row unchanged (still scheduled/retrying) so it is retried next
                // pass; do not bump retry, since this was not a card decline.
                log.warn("Mews charge error for schedule {}: {}", d.scheduleId(), e.getMessage());
                errors++;
            }
        }

        PassResult result = new PassResult(
                due.size(), charged, processing, failed, skippedStripe, errors);
        log.info("Installment charge pass asOf={} -> {}", asOf, result);
        return result;
    }

    /**
     * Maps a PMS charge outcome onto the installment status model. Async states
     * (Pending/Verifying) and an unreadable state fold to {@code PROCESSING} so
     * the row is neither treated as paid nor re-charged; declines fold to
     * {@code FAILED} so normal dunning applies.
     */
    static PaymentScheduleStatus mapChargeStatus(PmsChargeStatus status) {
        return switch (status) {
            case CHARGED -> PaymentScheduleStatus.PAID;
            case PENDING, VERIFYING, UNKNOWN -> PaymentScheduleStatus.PROCESSING;
            case FAILED, CANCELED -> PaymentScheduleStatus.FAILED;
        };
    }

    private static boolean isBlank(String s) {
        return s == null || s.isBlank();
    }

    /**
     * Resolves a property's own Mews charge context. Returns empty when the
     * property has no validated Mews connection, so the pass never charges one
     * property on another's credentials. {@link com.bliss.b2b.integration.pms.MewsAdapterFactory}
     * is the real implementation; tests supply a fake.
     */
    public interface ChargeContextResolver {
        Optional<ChargeContext> resolve(UUID merchantId);
    }

    /** A property-scoped adapter plus the currency it charges in. */
    public record ChargeContext(PmsAdapter adapter, String currency) {
    }

    /**
     * Charges a single due Stripe-rail installment off-session and records the
     * outcome, reusing the same {@code firePaymentOffSession} + {@code recordAttempt}
     * machinery the inline first charge and pay-early use. Completion is NOT done
     * here — {@link #runDuePass} applies it through the shared {@link Ledger}, so
     * both rails complete plans identically. The real implementation is
     * {@link JdbiStripeInstallmentCharger}; a null charger makes the pass skip
     * Stripe rows (its original behavior), which unit tests rely on.
     */
    public interface StripeInstallmentCharger {
        StripeChargeOutcome charge(DueInstallment due);
    }

    /**
     * Outcome of charging one Stripe row. {@link #PAID} triggers the completion
     * check in {@link #runDuePass}; {@link #REQUIRES_ACTION} (off-session 3DS) and
     * {@link #ERROR} (processor/transport error, row left scheduled) are both
     * counted as errors; {@link #SKIPPED} is a config gap (plan not active, no
     * vaulted card) left for a later pass.
     */
    public enum StripeChargeOutcome {
        PAID, PROCESSING, FAILED, REQUIRES_ACTION, SKIPPED, ERROR
    }

    /** Persistence boundary, kept narrow so it is trivial to fake in tests. */
    public interface Ledger {
        List<DueInstallment> findDue(LocalDate asOf);

        void markPaid(UUID scheduleId, String mewsPaymentId, Instant now);

        void markProcessing(UUID scheduleId, String mewsPaymentId, String note, Instant now);

        void markFailed(UUID scheduleId, String error, Instant now);

        void completePlanIfDone(UUID planId, ScheduleKind justPaidKind);
    }

    /** Tally of a single pass. */
    public record PassResult(
            int due, int charged, int processing, int failed, int skippedStripe, int errors) {
    }

    /**
     * Real {@link Ledger} over the database. Mirrors the existing Stripe
     * recording semantics exactly, but writes Mews ids to their own column and
     * replicates {@code PlanPortalService.maybeCompletePlan} for completion.
     */
    public static final class JdbiLedger implements Ledger {

        private final Jdbi jdbi;

        public JdbiLedger(Jdbi jdbi) {
            this.jdbi = jdbi;
        }

        @Override
        public List<DueInstallment> findDue(LocalDate asOf) {
            return jdbi.withHandle(h -> h.attach(DueChargeDao.class).findDueForCharge(asOf));
        }

        @Override
        public void markPaid(UUID scheduleId, String mewsPaymentId, Instant now) {
            jdbi.useHandle(h -> h.attach(PaymentScheduleDao.class)
                    .markPaidMews(scheduleId, mewsPaymentId, now));
        }

        @Override
        public void markProcessing(UUID scheduleId, String mewsPaymentId, String note, Instant now) {
            jdbi.useHandle(h -> h.attach(PaymentScheduleDao.class)
                    .recordMewsProcessing(scheduleId, mewsPaymentId, note, now));
        }

        @Override
        public void markFailed(UUID scheduleId, String error, Instant now) {
            jdbi.useHandle(h -> h.attach(PaymentScheduleDao.class)
                    .updateStatusWithError(scheduleId, PaymentScheduleStatus.FAILED.wire(), error, 1, now));
        }

        @Override
        public void completePlanIfDone(UUID planId, ScheduleKind justPaidKind) {
            // Same rule as PlanPortalService.maybeCompletePlan: only an
            // installment can complete a plan, and only when no scheduled row
            // remains and the state transition is allowed.
            if (justPaidKind != ScheduleKind.INSTALLMENT) {
                return;
            }
            jdbi.useTransaction(h -> {
                PaymentScheduleDao scheduleDao = h.attach(PaymentScheduleDao.class);
                if (scheduleDao.findNextScheduled(planId).isPresent()) {
                    return;
                }
                PaymentPlanDao planDao = h.attach(PaymentPlanDao.class);
                PaymentPlan plan = planDao.findById(planId).orElse(null);
                if (plan == null) {
                    return;
                }
                if (!PaymentPlanStateMachine.isAllowed(plan.status(), PaymentPlanStatus.COMPLETED)) {
                    return;
                }
                planDao.updateStatus(planId, PaymentPlanStatus.COMPLETED.wire());
            });
        }
    }
}
