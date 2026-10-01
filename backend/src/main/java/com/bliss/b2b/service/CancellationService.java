package com.bliss.b2b.service;

import com.bliss.b2b.domain.Booking;
import com.bliss.b2b.domain.Merchant;
import com.bliss.b2b.domain.PaymentPlan;
import com.bliss.b2b.domain.PaymentScheduleEntry;
import com.bliss.b2b.domain.PaymentScheduleStatus;
import com.bliss.b2b.payments.FeeType;
import com.bliss.b2b.payments.MerchantPlanRules;
import com.bliss.b2b.payments.RefundPolicy;
import com.bliss.b2b.integration.EmailService;
import com.bliss.b2b.integration.EmailTemplates;
import com.bliss.b2b.persistence.BookingDao;
import com.bliss.b2b.persistence.CustomerDao;
import com.bliss.b2b.persistence.GuestCreditDao;
import com.bliss.b2b.persistence.MerchantDao;
import com.bliss.b2b.persistence.MerchantMewsConnectionDao;
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
 * <p>A Stripe plan's net refund is executed: it is refunded in Stripe across
 * the plan's paid PaymentIntents, newest first, each under an idempotency key
 * of the plan and the intent, so cancelling twice never refunds twice. What
 * was actually refunded is recorded on the plan ({@code refunded_at},
 * {@code refund_amount_cents}). Synthetic demo intents ({@code pi_demo_*})
 * settle without a Stripe call, as demo charges do. Bliss keeps its fee: a
 * destination charge's refund reverses the transfer but not the application
 * fee.
 *
 * <p><b>Mews stays.</b> A booking with a Mews reservation is cancelled in Mews
 * first; if Mews refuses or cannot be reached, nothing changes here and the
 * caller gets a {@link MewsStayCanceller.StayCancellationException}. Then the
 * plan and booking are cancelled as usual, and there is no cash refund: the
 * amount the property's refund policy would return, less any cancellation
 * fee, is issued as a future-stay credit ({@code guest_credits}) and the hotel
 * is emailed so it can apply it when the guest books again. A
 * {@code credit_only} policy credits everything paid, less the fee.
 */
public class CancellationService {

    private static final Logger log = LoggerFactory.getLogger(CancellationService.class);
    private static final Logger audit = LoggerFactory.getLogger("bliss.cancellation");

    private final PaymentPlanDao planDao;
    private final PaymentScheduleDao scheduleDao;
    private final BookingDao bookingDao;
    private final MerchantPlanRulesService rulesService;
    private final MewsStayCanceller mewsStayCanceller;
    private final GuestCreditDao creditDao;
    private final MerchantMewsConnectionDao mewsConnectionDao;
    private final MerchantDao merchantDao;
    private final CustomerDao customerDao;
    private final EmailService emailService;
    /** Refunds Stripe PaymentIntents; null when Stripe is not configured. */
    private final StripeRefunder stripeRefunder;

    /**
     * Refunds up to {@code amountMinor} of one PaymentIntent and returns the
     * amount actually refunded. The production one is
     * {@link com.bliss.b2b.integration.StripePaymentsService#refundPaymentIntent}.
     */
    @FunctionalInterface
    public interface StripeRefunder {
        long refund(String paymentIntentId, long amountMinor, String idempotencyKey) throws Exception;
    }

    public CancellationService(
            PaymentPlanDao planDao,
            PaymentScheduleDao scheduleDao,
            BookingDao bookingDao,
            MerchantPlanRulesService rulesService,
            MewsStayCanceller mewsStayCanceller,
            GuestCreditDao creditDao,
            MerchantMewsConnectionDao mewsConnectionDao,
            MerchantDao merchantDao,
            CustomerDao customerDao,
            EmailService emailService,
            StripeRefunder stripeRefunder
    ) {
        this.planDao = planDao;
        this.scheduleDao = scheduleDao;
        this.bookingDao = bookingDao;
        this.rulesService = rulesService;
        this.mewsStayCanceller = mewsStayCanceller;
        this.creditDao = creditDao;
        this.mewsConnectionDao = mewsConnectionDao;
        this.merchantDao = merchantDao;
        this.customerDao = customerDao;
        this.emailService = emailService;
        this.stripeRefunder = stripeRefunder;
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
        boolean mewsStay = booking.mewsReservationId() != null;
        // A Mews stay is never refunded in cash; the would-be refund is credit.
        long creditCents = mewsStay ? creditFor(rules, paidCents, refundCents, feeCents) : 0L;
        long netRefundCents = mewsStay ? 0L : Math.max(0L, refundCents - feeCents);

        if (mewsStay) {
            // Before any Bliss change: a failure here must leave the plan as it was.
            mewsStayCanceller.cancel(booking, reason);
        }

        planDao.markCanceled(plan.id(), at, reason);
        // Stop every future charge: cancel the remaining non-terminal rows so
        // the scheduled-charge runner skips them. Paid rows stay as history.
        scheduleDao.cancelRemaining(plan.id());

        if (mewsStay) {
            bookingDao.markCanceled(booking.id());
            issueCredit(plan, booking, creditCents, reason);
        }
        long refundedCents = mewsStay || netRefundCents <= 0
                ? 0L
                : executeRefund(plan, schedule, netRefundCents, at);

        Assessment assessment = new Assessment(
                paidCents, paidInstallments, progressPercent,
                refundCents, feeCents, netRefundCents,
                rules.refundPolicy(), rules.cancellationFeeEnabled(), creditCents, refundedCents);

        audit.info(
                "plan.canceled plan={} reason='{}' at={} paid={} progress={}% policy={} refund={} fee={} net={} credit={}",
                plan.id(), reason, at,
                paidCents, progressPercent, rules.refundPolicy().wire(),
                refundCents, feeCents, netRefundCents, creditCents);
        log.info("Plan {} canceled: refund {}c, fee {}c (net {}c, refunded {}c)",
                plan.id(), refundCents, feeCents, netRefundCents, refundedCents);

        return new CancellationOutcome(plan.id(), at, reason, assessment);
    }

    /**
     * Refunds {@code netRefundCents} through Stripe and records what was
     * refunded. A failed intent is logged and skipped, the rest still go; the
     * shortfall is logged so it can be finished by hand. Returns the amount
     * actually refunded.
     */
    private long executeRefund(PaymentPlan plan, List<PaymentScheduleEntry> schedule,
            long netRefundCents, Instant at) {
        long refunded = 0L;
        for (java.util.Map.Entry<String, Long> part : allocateRefund(schedule, netRefundCents).entrySet()) {
            String intentId = part.getKey();
            long amount = part.getValue();
            if (intentId.startsWith("pi_demo_")) {
                refunded += amount;
                continue;
            }
            if (stripeRefunder == null) {
                log.warn("Plan {}: Stripe is not configured; refund of {} on {} not executed",
                        plan.id(), amount, intentId);
                continue;
            }
            try {
                refunded += stripeRefunder.refund(intentId, amount, "cancel-refund:" + plan.id() + ":" + intentId);
            } catch (Exception e) {
                log.error("Plan {}: refund of {} on {} failed: {}", plan.id(), amount, intentId, e.getMessage());
            }
        }
        if (refunded < netRefundCents) {
            log.warn("Plan {}: refunded {} of the {} owed; the rest needs a manual refund",
                    plan.id(), refunded, netRefundCents);
        }
        if (refunded > 0) {
            planDao.markRefunded(plan.id(), at, refunded);
        }
        return refunded;
    }

    /**
     * Splits a refund across the PaymentIntents that collected the plan's paid
     * rows, newest first, never more from an intent than its rows collected
     * (a pay off's rows share one intent and are summed). Rows with no intent
     * on record cannot be refunded in Stripe and are skipped.
     */
    static java.util.LinkedHashMap<String, Long> allocateRefund(
            List<PaymentScheduleEntry> schedule, long amount) {
        java.util.LinkedHashMap<String, Long> collectedByIntent = new java.util.LinkedHashMap<>();
        schedule.stream()
                .filter(e -> e.status() == PaymentScheduleStatus.PAID)
                .filter(e -> e.stripePaymentIntentId() != null && !e.stripePaymentIntentId().isBlank())
                .sorted(java.util.Comparator.comparingInt(PaymentScheduleEntry::sequence).reversed())
                .forEach(e -> collectedByIntent.merge(e.stripePaymentIntentId(), e.amountCents(), Long::sum));
        java.util.LinkedHashMap<String, Long> allocation = new java.util.LinkedHashMap<>();
        long remaining = amount;
        for (java.util.Map.Entry<String, Long> intent : collectedByIntent.entrySet()) {
            if (remaining <= 0) break;
            long take = Math.min(remaining, intent.getValue());
            allocation.put(intent.getKey(), take);
            remaining -= take;
        }
        return allocation;
    }

    /**
     * The future-stay credit for a cancelled Mews stay: what the refund policy
     * would return in cash, less the cancellation fee. {@code credit_only}
     * returns nothing in cash by definition, so it credits everything paid.
     */
    static long creditFor(MerchantPlanRules rules, long paidCents, long refundCents, long feeCents) {
        long base = rules.refundPolicy() == RefundPolicy.CREDIT_ONLY ? paidCents : refundCents;
        return Math.max(0L, base - feeCents);
    }

    /**
     * Records the credit and tells the hotel. Idempotent: the credit is keyed
     * on the plan, and the hotel is emailed only when this call issued it.
     */
    private void issueCredit(PaymentPlan plan, Booking booking, long creditCents, String reason) {
        // The credit is in what the guest paid: the booking's currency.
        String currency = booking.currency();
        if (currency == null || currency.isBlank()) {
            log.error("Plan {} canceled but booking {} has no currency; credit of {} minor units not issued",
                    plan.id(), booking.id(), creditCents);
            return;
        }
        int issued = creditDao.issue(booking.merchantId(), plan.customerId(), plan.id(), creditCents, currency,
                "Mews reservation " + booking.mewsReservationId() + " canceled (" + reason + ")");
        if (issued != 1) {
            return;
        }
        log.info("Plan {} canceled; future-stay credit of {}c {} issued", plan.id(), creditCents, currency);
        try {
            Merchant merchant = merchantDao.findById(booking.merchantId()).orElse(null);
            String guestEmail = customerDao.findById(plan.customerId()).map(c -> c.email()).orElse(null);
            if (merchant != null) {
                emailService.send(EmailTemplates.merchantGuestCreditIssued(
                        merchant, booking, guestEmail, creditCents, currency));
            }
        } catch (RuntimeException e) {
            // The credit is recorded; a failed notice must not undo the cancel.
            log.warn("Could not email credit notice for plan {}: {}", plan.id(), e.getMessage());
        }
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
            boolean cancellationFeeEnabled,
            // Mews stays only: future-stay credit issued instead of a cash refund.
            long creditCents,
            // Stripe plans: what was actually refunded, which can be less than
            // netRefundCents when an intent failed or has no id on record.
            long refundedCents
    ) {}
}
