package com.bliss.b2b.api;

import com.bliss.b2b.domain.PaymentPlan;
import com.bliss.b2b.domain.PaymentPlanStatus;
import com.bliss.b2b.domain.PaymentScheduleEntry;
import com.bliss.b2b.domain.PaymentScheduleStatus;
import com.bliss.b2b.payments.AfterRetriesAction;
import com.bliss.b2b.payments.MerchantPlanRules;
import com.bliss.b2b.persistence.MerchantPlanRulesDao;
import com.bliss.b2b.persistence.PaymentPlanDao;
import com.bliss.b2b.persistence.PaymentScheduleDao;
import com.bliss.b2b.persistence.BookingDao;
import com.bliss.b2b.domain.Booking;
import com.bliss.b2b.service.CancellationService;
import com.bliss.b2b.service.PaymentPlanStateMachine;
import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Dev-mode helpers for demoing failure flows. Every endpoint here is gated
 * on the {@code devEnabled} flag (true when {@code BLISS_ENV != production})
 * and returns 404 in production.
 */
@Path("/api/v1/dev")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class DevPlansResource {

    private static final Logger log = LoggerFactory.getLogger(DevPlansResource.class);

    private final boolean devEnabled;
    private final PaymentPlanDao planDao;
    private final PaymentScheduleDao scheduleDao;
    private final MerchantPlanRulesDao rulesDao;
    private final BookingDao bookingDao;
    private final CancellationService cancellationService;

    public DevPlansResource(
            boolean devEnabled,
            PaymentPlanDao planDao,
            PaymentScheduleDao scheduleDao,
            MerchantPlanRulesDao rulesDao,
            BookingDao bookingDao,
            CancellationService cancellationService
    ) {
        this.devEnabled = devEnabled;
        this.planDao = planDao;
        this.scheduleDao = scheduleDao;
        this.rulesDao = rulesDao;
        this.bookingDao = bookingDao;
        this.cancellationService = cancellationService;
    }

    /**
     * Simulate a failed payment on the next scheduled installment.
     *
     * <p>Mode {@code fail} (default): flip the next scheduled installment
     * to FAILED, bump retry_count, and move the plan to
     * PAYMENT_FAILED_IN_RETRY.
     *
     * <p>Mode {@code exhaust}: same as {@code fail}, then apply the
     * merchant's {@link com.bliss.b2b.payments.AfterRetriesAction} to push
     * the plan to its terminal state (defaulted / canceled / balance-due-
     * at-arrival, etc.).
     */
    @POST
    @Path("/plans/{id}/mark-failed")
    public Response markFailed(@PathParam("id") String idString, MarkFailedRequest req) {
        if (!devEnabled) return notFound();
        UUID planId;
        try {
            planId = UUID.fromString(idString);
        } catch (IllegalArgumentException e) {
            return notFound();
        }
        PaymentPlan plan = planDao.findById(planId).orElse(null);
        if (plan == null) return notFound();

        Optional<PaymentScheduleEntry> nextMaybe = scheduleDao.findNextScheduled(plan.id());
        if (nextMaybe.isEmpty()) {
            return Response.status(409).entity(Map.of(
                    "error", "no_scheduled_installment",
                    "message", "Plan has no scheduled installment to fail.")).build();
        }
        PaymentScheduleEntry next = nextMaybe.get();
        String reason = req == null || req.reason() == null
                ? "card_declined (dev-mode simulation)"
                : req.reason();
        scheduleDao.updateStatusWithError(
                next.id(),
                PaymentScheduleStatus.FAILED.wire(),
                reason,
                1,
                Instant.now());

        String mode = req == null || req.mode() == null ? "fail" : req.mode();
        PaymentPlanStatus newStatus;
        String terminalAction = null;
        java.util.Map<String, Object> response = new java.util.LinkedHashMap<>();
        if ("exhaust".equalsIgnoreCase(mode)) {
            Booking booking = bookingDao.findById(plan.bookingId())
                    .orElseThrow(() -> new IllegalStateException("booking not found"));
            MerchantPlanRules rules = rulesDao.findByMerchantId(booking.merchantId())
                    .orElse(MerchantPlanRules.DEFAULTS);
            terminalAction = rules.afterRetriesAction().wire();
            if (rules.afterRetriesAction() == AfterRetriesAction.TREAT_AS_CANCELLATION) {
                // Single canonical path: same cancellation handler the customer
                // hits when they cancel. Refund + fee evaluate against now.
                CancellationService.CancellationOutcome outcome =
                        cancellationService.cancel(plan, Instant.now(), "retries_exhausted");
                newStatus = PaymentPlanStatus.CANCELED;
                response.put("refundCents", outcome.assessment().refundCents());
                response.put("feeCents", outcome.assessment().feeCents());
                response.put("netRefundCents", outcome.assessment().netRefundCents());
            } else {
                newStatus = PaymentPlanStateMachine.resolveTerminalState(rules.afterRetriesAction());
                planDao.updateStatus(plan.id(), newStatus.wire());
            }
        } else {
            newStatus = PaymentPlanStatus.PAYMENT_FAILED_IN_RETRY;
            planDao.updateStatus(plan.id(), newStatus.wire());
        }
        log.info("Dev-mode mark-failed plan={} mode={} newStatus={} terminalAction={}",
                plan.id(), mode, newStatus.wire(), terminalAction);
        response.put("status", "ok");
        response.put("mode", mode);
        response.put("planStatus", newStatus.wire());
        response.put("failedInstallmentSequence", next.sequence());
        response.put("afterRetriesAction", terminalAction == null ? "n/a" : terminalAction);
        return Response.ok(response).build();
    }

    private static Response notFound() {
        return Response.status(404).entity(Map.of("error", "not_found")).build();
    }

    public record MarkFailedRequest(
            @JsonProperty("mode") String mode,
            @JsonProperty("reason") String reason
    ) {}
}
