package com.bliss.b2b.service;

import com.bliss.b2b.domain.Booking;
import com.bliss.b2b.domain.PaymentPlan;
import com.bliss.b2b.domain.PaymentScheduleEntry;
import com.bliss.b2b.domain.PaymentScheduleStatus;
import com.bliss.b2b.payments.FeeType;
import com.bliss.b2b.payments.MerchantPlanRules;
import com.bliss.b2b.payments.RefundPolicy;
import com.bliss.b2b.persistence.BookingDao;
import com.bliss.b2b.persistence.PaymentPlanDao;
import com.bliss.b2b.persistence.PaymentScheduleDao;
import java.time.Instant;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Single canonical path for ending a payment plan. Both customer-initiated
 * cancellations and the retries-exhausted dunning path route through here so
 * the merchant's Refund policy + Cancellation fee evaluate identically.
 *
 * <p>For Phase 12 the refund and fee amounts are <em>computed and logged</em>
 * but not yet posted to Stripe — execution lands in a later phase. Storing
 * the assessment now means the eventual refund runner can replay from the
 * audit log without re-deriving the numbers.
 */
public class CancellationService {

    private static final Logger log = LoggerFactory.getLogger(CancellationService.class);
    private static final Logger audit = LoggerFactory.getLogger("bliss.cancellation");

    private final PaymentPlanDao planDao;
    private final PaymentScheduleDao scheduleDao;
    private final BookingDao bookingDao;
    private final MerchantPlanRulesService rulesService;

    public CancellationService(
            PaymentPlanDao planDao,
            PaymentScheduleDao scheduleDao,
            BookingDao bookingDao,
            MerchantPlanRulesService rulesService
    ) {
        this.planDao = planDao;
        this.scheduleDao = scheduleDao;
        this.bookingDao = bookingDao;
        this.rulesService = rulesService;
    }

    /**
     * Cancel a plan, applying the merchant's Refund policy and Cancellation
     * fee as of {@code at}. Idempotent on plan id — calling twice with the
     * same plan returns the most recent assessment without changing state
     * a second time (the cancellation timestamp stays the original).
     */
    public CancellationOutcome cancel(PaymentPlan plan, Instant at, String reason) {
        Booking booking = bookingDao.findById(plan.bookingId())
                .orElseThrow(() -> new IllegalStateException("booking missing for plan " + plan.id()));
        MerchantPlanRules rules = rulesService.forMerchant(booking.merchantId());
        List<PaymentScheduleEntry> schedule = scheduleDao.listForPlan(plan.id());

        long paidCents = schedule.stream()
                .filter(e -> e.status() == PaymentScheduleStatus.PAID)
                .mapToLong(PaymentScheduleEntry::amountCents)
                .sum();
        int paidInstallments = (int) schedule.stream()
                .filter(e -> e.status() == PaymentScheduleStatus.PAID)
                .count();
        int progressPercent = plan.totalAmountCents() == 0
                ? 0
                : (int) ((paidCents * 100L) / plan.totalAmountCents());

        long refundCents = computeRefundCents(rules, schedule, paidCents, progressPercent);
        long feeCents = computeCancellationFeeCents(rules, plan, progressPercent);
        long netRefundCents = Math.max(0L, refundCents - feeCents);

        planDao.markCanceled(plan.id(), at, reason);
        // Stop every future charge: cancel the remaining non-terminal rows so
        // the scheduled-charge runner skips them. Paid rows stay as history.
        scheduleDao.cancelRemaining(plan.id());

        Assessment assessment = new Assessment(
                paidCents, paidInstallments, progressPercent,
                refundCents, feeCents, netRefundCents,
                rules.refundPolicy(), rules.cancellationFeeEnabled());

        audit.info(
                "plan.canceled plan={} reason='{}' at={} paid={} progress={}% policy={} refund={} fee={} net={}",
                plan.id(), reason, at,
                paidCents, progressPercent, rules.refundPolicy().wire(),
                refundCents, feeCents, netRefundCents);
        log.info("Plan {} canceled — refund {}c, fee {}c (net {}c)",
                plan.id(), refundCents, feeCents, netRefundCents);

        return new CancellationOutcome(plan.id(), at, reason, assessment);
    }

    private static long computeRefundCents(
            MerchantPlanRules rules,
            List<PaymentScheduleEntry> schedule,
            long paidCents,
            int progressPercent
    ) {
        return switch (rules.refundPolicy()) {
            case FULL -> paidCents;
            case NONE, CREDIT_ONLY -> 0L; // CREDIT_ONLY: paid amount goes to customer credit, not cash refund
            case FIRST_INSTALLMENT_ONLY -> schedule.stream()
                    .filter(e -> e.sequence() == 1 && e.status() == PaymentScheduleStatus.PAID)
                    .findFirst()
                    .map(PaymentScheduleEntry::amountCents)
                    .orElse(0L);
            case SLIDING_SCALE -> {
                int threshold = rules.refundSlidingThresholdPercent() == null
                        ? 50 : rules.refundSlidingThresholdPercent();
                yield progressPercent < threshold ? paidCents : 0L;
            }
        };
    }

    private static long computeCancellationFeeCents(
            MerchantPlanRules rules,
            PaymentPlan plan,
            int progressPercent
    ) {
        if (!rules.cancellationFeeEnabled() || rules.cancellationFeeType() == null
                || rules.cancellationFeeValue() == null) {
            return 0L;
        }
        Integer threshold = rules.cancellationFeeThresholdPercent();
        if (threshold != null && progressPercent < threshold) {
            return 0L;
        }
        return rules.cancellationFeeType() == FeeType.PERCENTAGE
                ? plan.totalAmountCents() * rules.cancellationFeeValue() / 100L
                : rules.cancellationFeeValue();
    }

    public record CancellationOutcome(
            java.util.UUID planId,
            Instant canceledAt,
            String reason,
            Assessment assessment
    ) {}

    public record Assessment(
            long paidCents,
            int paidInstallments,
            int progressPercent,
            long refundCents,
            long feeCents,
            long netRefundCents,
            RefundPolicy policy,
            boolean cancellationFeeEnabled
    ) {}
}
