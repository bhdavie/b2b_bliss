package com.bliss.b2b.service;

import com.bliss.b2b.domain.Booking;
import com.bliss.b2b.domain.Merchant;
import com.bliss.b2b.integration.EmailService;
import com.bliss.b2b.integration.EmailTemplates;
import com.bliss.b2b.persistence.BookingDao;
import com.bliss.b2b.persistence.MerchantDao;
import com.bliss.b2b.persistence.PlanDisputeDao;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;
import org.jdbi.v3.core.Jdbi;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Card disputes on Bliss charges (docs/disputes-spec.md). A
 * {@code charge.dispute.created} event attaches the dispute to the plan and
 * payment whose PaymentIntent was disputed, flags it to the hotel and in
 * admin, and emails Bliss's operations address once. Later
 * {@code charge.dispute.updated} and {@code charge.dispute.closed} events keep
 * its status current. A dispute Bliss can't match to a plan is still recorded,
 * and the email says so.
 */
public class DisputeService {

    private static final Logger log = LoggerFactory.getLogger(DisputeService.class);
    private static final ObjectMapper JSON = new ObjectMapper();

    private final Jdbi jdbi;
    private final EmailService emailService;
    private final String opsEmail;

    public DisputeService(Jdbi jdbi, EmailService emailService, String opsEmail) {
        this.jdbi = jdbi;
        this.emailService = emailService;
        this.opsEmail = opsEmail == null ? "" : opsEmail.trim();
    }

    /** What Bliss did with an event. */
    public enum Outcome { RECORDED, UPDATED, ALREADY_KNOWN, IGNORED }

    /**
     * Applies a {@code charge.dispute.*} event, given its type and the raw JSON
     * of its dispute object (read raw so the event's API version doesn't matter).
     */
    public Outcome apply(String type, String disputeJson) {
        if (type == null || !type.startsWith("charge.dispute.")) {
            return Outcome.IGNORED;
        }
        JsonNode d;
        try {
            d = JSON.readTree(disputeJson);
        } catch (Exception e) {
            throw new IllegalArgumentException("unreadable dispute: " + e.getMessage(), e);
        }
        String disputeId = text(d, "id");
        if (disputeId == null) {
            throw new IllegalArgumentException("dispute has no id");
        }
        String status = text(d, "status");
        long amount = d.path("amount").asLong();
        String currency = Optional.ofNullable(text(d, "currency")).orElse("").toUpperCase(Locale.ROOT);
        String reason = text(d, "reason");
        Instant dueBy = d.path("evidence_details").hasNonNull("due_by")
                ? Instant.ofEpochSecond(d.path("evidence_details").get("due_by").asLong()) : null;

        PlanDisputeDao dao = jdbi.onDemand(PlanDisputeDao.class);
        if (dao.find(disputeId).isPresent()) {
            dao.update(disputeId, status, amount, reason, dueBy);
            log.info("Dispute {} is now {}", disputeId, status);
            return "charge.dispute.created".equals(type) ? Outcome.ALREADY_KNOWN : Outcome.UPDATED;
        }

        // First sight (normally charge.dispute.created; any dispute event for a
        // dispute Bliss missed is recorded the same way).
        String intentId = text(d, "payment_intent");
        Match match = intentId == null ? Match.NONE : match(intentId);
        int inserted = dao.insert(disputeId, text(d, "charge"), intentId, match.planId(), match.scheduleId(),
                match.merchantId(), amount, currency, reason, status, dueBy, d.path("livemode").asBoolean(false));
        if (inserted == 0) {
            return Outcome.ALREADY_KNOWN;
        }
        log.warn("Card dispute {} opened: {} {} ({}) on plan {}", disputeId, amount, currency, reason,
                match.planId());
        emailOps(dao.find(disputeId).orElseThrow(), match);
        return Outcome.RECORDED;
    }

    /** The plan, payment and property a PaymentIntent paid, when Bliss made it. */
    record Match(UUID planId, UUID scheduleId, UUID merchantId, UUID bookingId) {
        static final Match NONE = new Match(null, null, null, null);
    }

    private Match match(String intentId) {
        return jdbi.withHandle(h -> h.createQuery("""
                        SELECT pp.id AS plan_id, ps.id AS schedule_id, b.merchant_id, b.id AS booking_id
                        FROM payment_schedule ps
                        JOIN payment_plans pp ON pp.id = ps.payment_plan_id
                        JOIN bookings b ON b.id = pp.booking_id
                        WHERE ps.stripe_payment_intent_id = :pi
                        ORDER BY ps.sequence
                        LIMIT 1""")
                .bind("pi", intentId)
                .map((rs, ctx) -> new Match((UUID) rs.getObject("plan_id"), (UUID) rs.getObject("schedule_id"),
                        (UUID) rs.getObject("merchant_id"), (UUID) rs.getObject("booking_id")))
                .findOne()).orElse(Match.NONE);
    }

    private void emailOps(PlanDisputeDao.Dispute dispute, Match match) {
        if (opsEmail.isEmpty() || emailService == null) {
            log.warn("Dispute {} not emailed: BLISS_OPS_EMAIL is not set", dispute.stripeDisputeId());
            return;
        }
        try {
            Merchant merchant = match.merchantId() == null ? null
                    : jdbi.withExtension(MerchantDao.class, d -> d.findById(match.merchantId())).orElse(null);
            Booking booking = match.bookingId() == null ? null
                    : jdbi.withExtension(BookingDao.class, d -> d.findById(match.bookingId())).orElse(null);
            emailService.send(EmailTemplates.disputeOpened(opsEmail, dispute, merchant, booking));
        } catch (RuntimeException e) {
            log.warn("Dispute {} email not sent: {}", dispute.stripeDisputeId(), e.toString());
        }
    }

    private static String text(JsonNode n, String field) {
        JsonNode v = n.get(field);
        return v == null || v.isNull() ? null : v.asText();
    }
}
