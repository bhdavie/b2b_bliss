package com.bliss.b2b.service;

import com.bliss.b2b.domain.Booking;
import com.bliss.b2b.domain.Customer;
import com.bliss.b2b.domain.Merchant;
import com.bliss.b2b.domain.PaymentPlan;
import com.bliss.b2b.domain.PaymentPlanStatus;
import com.bliss.b2b.domain.PaymentScheduleEntry;
import com.bliss.b2b.domain.PaymentScheduleStatus;
import com.bliss.b2b.integration.EmailMessage;
import com.bliss.b2b.integration.EmailService;
import com.bliss.b2b.integration.EmailTemplates;
import com.bliss.b2b.payments.MerchantPlanRules;
import com.bliss.b2b.persistence.BookingDao;
import com.bliss.b2b.persistence.CustomerDao;
import com.bliss.b2b.persistence.EmailLogDao;
import com.bliss.b2b.persistence.MerchantDao;
import com.bliss.b2b.persistence.MerchantPlanRulesDao;
import com.bliss.b2b.persistence.PaymentPlanDao;
import com.bliss.b2b.persistence.PaymentScheduleDao;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import java.util.function.Supplier;
import org.jdbi.v3.core.Jdbi;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Sends the four guest transactional emails at plan lifecycle transitions. Called
 * from the state-transition code (plan creation, the charge/reconciliation
 * passes, the Mews checkout seam), never from a rail adapter, so every rail gets
 * the same emails.
 *
 * <p>Every send is:
 * <ul>
 *   <li><b>idempotent</b> — an {@link EmailLogDao} dedupe key is claimed first;
 *       only the winner sends, so a reconciliation retry (or a duplicate
 *       lifecycle call) never double-sends.
 *   <li><b>fire-and-forget</b> — all failures are caught and logged; a mail
 *       problem never blocks a charge or a state transition.
 * </ul>
 */
public class PlanNotificationService {

    private static final Logger log = LoggerFactory.getLogger(PlanNotificationService.class);

    private final Jdbi jdbi;
    private final EmailService emailService;
    private final String consumerBaseUrl;

    public PlanNotificationService(Jdbi jdbi, EmailService emailService, String consumerBaseUrl) {
        this.jdbi = jdbi;
        this.emailService = emailService;
        this.consumerBaseUrl = consumerBaseUrl;
    }

    /** 1. Plan activated (pending_card -> active, or created active). */
    public void onPlanActivated(UUID planId) {
        dispatch("plan_activated:" + planId, "plan_activated", () -> jdbi.withHandle(h -> {
            Ctx c = load(h, planId);
            if (c == null) return null;
            return EmailTemplates.planConfirmation(
                    c.customer.email(), c.merchant, c.booking, c.plan, c.schedule, consumerBaseUrl);
        }));
    }

    /** 2. An installment settled to PAID. */
    public void onInstallmentPaid(UUID planId, UUID scheduleId) {
        dispatch("receipt:" + scheduleId, "receipt", () -> jdbi.withHandle(h -> {
            Ctx c = load(h, planId);
            if (c == null) return null;
            PaymentScheduleEntry row = c.schedule.stream()
                    .filter(e -> e.id().equals(scheduleId)).findFirst().orElse(null);
            if (row == null) return null;
            long paid = sum(c.schedule, PaymentScheduleStatus.PAID);
            long total = c.schedule.stream()
                    .filter(e -> e.status() != PaymentScheduleStatus.CANCELED)
                    .mapToLong(PaymentScheduleEntry::amountCents).sum();
            long remaining = Math.max(0, total - paid);
            PaymentScheduleEntry next = c.schedule.stream()
                    .filter(e -> e.status() == PaymentScheduleStatus.SCHEDULED)
                    .min(java.util.Comparator.comparing(PaymentScheduleEntry::dueDate))
                    .orElse(null);
            return EmailTemplates.paymentReceipt(
                    c.customer.email(), c.merchant, c.booking, row.amountCents(), remaining,
                    next == null ? null : next.dueDate(),
                    next == null ? null : next.amountCents(),
                    consumerBaseUrl);
        }));
    }

    /** 3. Plan completed. Self-guards: only sends when the plan is actually COMPLETED. */
    public void onPlanCompleted(UUID planId) {
        dispatch("plan_complete:" + planId, "plan_complete", () -> jdbi.withHandle(h -> {
            Ctx c = load(h, planId);
            if (c == null || c.plan.status() != PaymentPlanStatus.COMPLETED) return null;
            long paid = sum(c.schedule, PaymentScheduleStatus.PAID);
            return EmailTemplates.planComplete(c.customer.email(), c.merchant, c.booking, paid, consumerBaseUrl);
        }));
    }

    /** 4. An installment entered the failure/retry path. */
    public void onInstallmentFailed(UUID planId, UUID scheduleId) {
        dispatch("failed:" + scheduleId, "failed", () -> jdbi.withHandle(h -> {
            Ctx c = load(h, planId);
            if (c == null) return null;
            PaymentScheduleEntry row = c.schedule.stream()
                    .filter(e -> e.id().equals(scheduleId)).findFirst().orElse(null);
            if (row == null) return null;
            MerchantPlanRules rules = h.attach(MerchantPlanRulesDao.class)
                    .findByMerchantId(c.merchant.id()).orElse(MerchantPlanRules.DEFAULTS);
            return EmailTemplates.paymentFailed(
                    c.customer.email(), c.merchant, c.booking, row.amountCents(),
                    rules.retryAttempts(), rules.retrySpacingDays(), consumerBaseUrl);
        }));
    }

    /**
     * Builds the message; if there is one to send, claims the dedupe slot and, on
     * winning it, sends. Everything is wrapped so a failure only logs.
     */
    private void dispatch(String dedupeKey, String type, Supplier<EmailMessage> build) {
        try {
            EmailMessage message = build.get();
            if (message == null || message.to() == null || message.to().isBlank()) {
                return;
            }
            int claimed = jdbi.withHandle(h ->
                    h.attach(EmailLogDao.class).claim(dedupeKey, type, message.to()));
            if (claimed != 1) {
                return; // already sent by another path/retry
            }
            emailService.send(message);
        } catch (RuntimeException e) {
            log.warn("Notification {} failed (non-blocking): {}", dedupeKey, e.getMessage());
        }
    }

    private static long sum(List<PaymentScheduleEntry> schedule, PaymentScheduleStatus status) {
        return schedule.stream()
                .filter(e -> e.status() == status)
                .mapToLong(PaymentScheduleEntry::amountCents).sum();
    }

    private static Ctx load(org.jdbi.v3.core.Handle h, UUID planId) {
        PaymentPlan plan = h.attach(PaymentPlanDao.class).findById(planId).orElse(null);
        if (plan == null) return null;
        Booking booking = h.attach(BookingDao.class).findById(plan.bookingId()).orElse(null);
        if (booking == null) return null;
        Merchant merchant = h.attach(MerchantDao.class).findById(booking.merchantId()).orElse(null);
        if (merchant == null) return null;
        Customer customer = h.attach(CustomerDao.class).findById(plan.customerId()).orElse(null);
        if (customer == null || customer.email() == null) return null;
        List<PaymentScheduleEntry> schedule = h.attach(PaymentScheduleDao.class).listForPlan(planId);
        return new Ctx(plan, booking, merchant, customer, schedule);
    }

    private record Ctx(PaymentPlan plan, Booking booking, Merchant merchant,
                       Customer customer, List<PaymentScheduleEntry> schedule) {
    }

    /** A no-op used where notifications are not wired (e.g. unit tests). */
    public static PlanNotificationService disabled() {
        return new PlanNotificationService(null, null, null) {
            @Override public void onPlanActivated(UUID planId) {}
            @Override public void onInstallmentPaid(UUID planId, UUID scheduleId) {}
            @Override public void onPlanCompleted(UUID planId) {}
            @Override public void onInstallmentFailed(UUID planId, UUID scheduleId) {}
        };
    }
}
