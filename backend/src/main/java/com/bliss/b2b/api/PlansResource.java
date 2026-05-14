package com.bliss.b2b.api;

import com.bliss.b2b.auth.MerchantPrincipal;
import com.bliss.b2b.domain.Booking;
import com.bliss.b2b.domain.PaymentPlan;
import com.bliss.b2b.domain.PaymentPlanStatus;
import com.bliss.b2b.domain.PaymentScheduleEntry;
import com.bliss.b2b.domain.PaymentScheduleStatus;
import com.bliss.b2b.persistence.BookingDao;
import com.bliss.b2b.persistence.PaymentPlanDao;
import com.bliss.b2b.persistence.PaymentScheduleDao;
import com.fasterxml.jackson.annotation.JsonProperty;
import io.dropwizard.auth.Auth;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * Merchant-facing payment plan management: list plans needing attention,
 * retrieve plan detail, and manually trigger retries / cancel / resolve /
 * override the state from the dashboard.
 *
 * <p>For demo purposes, the manual retry endpoint simulates a successful
 * retry: it marks the failed installment as paid and returns the plan to
 * {@code ACTIVE}. In production the real retry runner (Phase 5) would
 * coordinate with Stripe; this stub keeps the merchant UX flowing.
 */
@Path("/api/v1/plans")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class PlansResource {

    private final PaymentPlanDao planDao;
    private final PaymentScheduleDao scheduleDao;
    private final BookingDao bookingDao;

    public PlansResource(
            PaymentPlanDao planDao,
            PaymentScheduleDao scheduleDao,
            BookingDao bookingDao
    ) {
        this.planDao = planDao;
        this.scheduleDao = scheduleDao;
        this.bookingDao = bookingDao;
    }

    @GET
    @Path("/attention")
    public AttentionResponse listAttention(@Auth MerchantPrincipal principal) {
        UUID merchantId = principal.merchant().id();
        List<PaymentPlan> plans = planDao.findAttentionForMerchant(merchantId);
        List<PlanDetailView> views = plans.stream()
                .map(p -> hydrate(p, merchantId))
                .filter(Optional::isPresent)
                .map(Optional::get)
                .toList();
        return new AttentionResponse(views, views.size());
    }

    @GET
    @Path("/{id}")
    public Response get(@Auth MerchantPrincipal principal, @PathParam("id") String idString) {
        UUID id;
        try {
            id = UUID.fromString(idString);
        } catch (IllegalArgumentException e) {
            return notFound();
        }
        return planDao.findByIdForMerchant(id, principal.merchant().id())
                .flatMap(p -> hydrate(p, principal.merchant().id()))
                .map(view -> Response.ok(view).build())
                .orElseGet(() -> notFound());
    }

    @POST
    @Path("/{id}/retry")
    public Response retry(@Auth MerchantPrincipal principal, @PathParam("id") String idString) {
        UUID id = parseUuid(idString);
        if (id == null) return notFound();
        PaymentPlan plan = planDao.findByIdForMerchant(id, principal.merchant().id()).orElse(null);
        if (plan == null) return notFound();
        // Find the failed installment; mark it paid (simulated retry success).
        Optional<PaymentScheduleEntry> failed = scheduleDao.listForPlan(plan.id()).stream()
                .filter(e -> e.status() == PaymentScheduleStatus.FAILED
                        || e.status() == PaymentScheduleStatus.RETRYING)
                .findFirst();
        if (failed.isEmpty()) {
            return Response.status(409).entity(Map.of(
                    "error", "no_failed_installment",
                    "message", "This plan has no installment in a failed state to retry.")).build();
        }
        scheduleDao.updateStatusWithError(
                failed.get().id(),
                PaymentScheduleStatus.PAID.wire(),
                null,
                0,
                Instant.now());
        planDao.updateStatus(plan.id(), PaymentPlanStatus.ACTIVE.wire());
        return Response.ok(Map.of("status", "ok", "newPlanStatus", "active")).build();
    }

    @POST
    @Path("/{id}/cancel")
    public Response cancel(@Auth MerchantPrincipal principal, @PathParam("id") String idString) {
        UUID id = parseUuid(idString);
        if (id == null) return notFound();
        PaymentPlan plan = planDao.findByIdForMerchant(id, principal.merchant().id()).orElse(null);
        if (plan == null) return notFound();
        planDao.updateStatus(plan.id(), PaymentPlanStatus.CANCELED.wire());
        return Response.ok(Map.of("status", "ok", "newPlanStatus", "canceled")).build();
    }

    @POST
    @Path("/{id}/resolve")
    public Response resolve(@Auth MerchantPrincipal principal, @PathParam("id") String idString) {
        UUID id = parseUuid(idString);
        if (id == null) return notFound();
        PaymentPlan plan = planDao.findByIdForMerchant(id, principal.merchant().id()).orElse(null);
        if (plan == null) return notFound();
        planDao.updateStatus(plan.id(), PaymentPlanStatus.ACTIVE.wire());
        return Response.ok(Map.of("status", "ok", "newPlanStatus", "active")).build();
    }

    @POST
    @Path("/{id}/override-state")
    public Response override(
            @Auth MerchantPrincipal principal,
            @PathParam("id") String idString,
            OverrideRequest req
    ) {
        UUID id = parseUuid(idString);
        if (id == null) return notFound();
        if (req == null || req.status() == null) {
            return Response.status(400).entity(Map.of("error", "status required")).build();
        }
        PaymentPlanStatus newStatus;
        try {
            newStatus = PaymentPlanStatus.fromWire(req.status());
        } catch (IllegalArgumentException e) {
            return Response.status(400).entity(Map.of("error", "unknown status")).build();
        }
        PaymentPlan plan = planDao.findByIdForMerchant(id, principal.merchant().id()).orElse(null);
        if (plan == null) return notFound();
        planDao.updateStatus(plan.id(), newStatus.wire());
        return Response.ok(Map.of("status", "ok", "newPlanStatus", newStatus.wire())).build();
    }

    private Optional<PlanDetailView> hydrate(PaymentPlan plan, UUID merchantId) {
        Optional<Booking> booking = bookingDao.findByIdForMerchant(plan.bookingId(), merchantId);
        if (booking.isEmpty()) return Optional.empty();
        List<PaymentScheduleEntry> schedule = scheduleDao.listForPlan(plan.id());
        return Optional.of(PlanDetailView.from(plan, booking.get(), schedule));
    }

    private static UUID parseUuid(String s) {
        try {
            return UUID.fromString(s);
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    private static Response notFound() {
        return Response.status(404).entity(Map.of("error", "not_found")).build();
    }

    public record AttentionResponse(List<PlanDetailView> plans, int count) {}

    public record OverrideRequest(@JsonProperty("status") String status) {}

    public record PlanDetailView(
            String id,
            String bookingId,
            String serviceName,
            LocalDate appointmentDate,
            long totalAmountCents,
            long depositAmountCents,
            String frequency,
            int numPayments,
            String status,
            String customerHint,
            List<ScheduleEntryDetail> schedule,
            FailedInstallmentInfo failedInstallment
    ) {
        public static PlanDetailView from(PaymentPlan plan, Booking booking, List<PaymentScheduleEntry> schedule) {
            List<ScheduleEntryDetail> entries = schedule.stream()
                    .map(ScheduleEntryDetail::from)
                    .toList();
            FailedInstallmentInfo failed = schedule.stream()
                    .filter(e -> e.status() == PaymentScheduleStatus.FAILED
                            || e.status() == PaymentScheduleStatus.RETRYING)
                    .findFirst()
                    .map(e -> new FailedInstallmentInfo(
                            e.sequence(), e.dueDate(), e.amountCents(),
                            e.retryCount(), e.lastError()))
                    .orElse(null);
            String customerHint = booking.customerNameHint() != null
                    ? booking.customerNameHint()
                    : booking.customerEmailHint();
            return new PlanDetailView(
                    plan.id().toString(),
                    plan.bookingId().toString(),
                    booking.serviceName(),
                    booking.appointmentDate(),
                    plan.totalAmountCents(),
                    plan.depositAmountCents(),
                    plan.frequency().wire(),
                    plan.numPayments(),
                    plan.status().wire(),
                    customerHint,
                    entries,
                    failed
            );
        }
    }

    public record ScheduleEntryDetail(
            int sequence,
            String kind,
            LocalDate dueDate,
            long amountCents,
            String status,
            int retryCount
    ) {
        static ScheduleEntryDetail from(PaymentScheduleEntry e) {
            return new ScheduleEntryDetail(
                    e.sequence(),
                    e.kind().wire(),
                    e.dueDate(),
                    e.amountCents(),
                    e.status().wire(),
                    e.retryCount()
            );
        }
    }

    public record FailedInstallmentInfo(
            int sequence,
            LocalDate dueDate,
            long amountCents,
            int retryCount,
            String lastError
    ) {}
}
