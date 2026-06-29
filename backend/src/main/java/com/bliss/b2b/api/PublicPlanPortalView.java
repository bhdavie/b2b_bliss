package com.bliss.b2b.api;

import com.bliss.b2b.domain.Booking;
import com.bliss.b2b.domain.CustomerCard;
import com.bliss.b2b.domain.Merchant;
import com.bliss.b2b.domain.PaymentPlan;
import com.bliss.b2b.domain.PaymentScheduleEntry;
import com.bliss.b2b.integration.StripePaymentsService;
import com.bliss.b2b.service.PlanPortalService.PortalSnapshot;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;

/**
 * Wire shape returned by {@code GET /api/v1/public/plans/{bookingToken}}.
 * All money values are pre-derived server-side so the frontend reads them
 * directly without re-running the discount/fee math. Mirrors the source-of-
 * truth derivations the {@code Confirmation} component uses.
 */
public record PublicPlanPortalView(
        MerchantView merchant,
        BookingView booking,
        PlanView plan,
        List<ScheduleEntryView> schedule,
        CardView card,
        long processingFeeCents,
        long paidCents,
        long remainingCents,
        LocalDate nextDueDate,
        Long nextDueAmountCents,
        boolean complete,
        StripeStateView stripe
) {

    public static PublicPlanPortalView from(PortalSnapshot s, StripePaymentsService stripeService) {
        // As-of-today derivation (single source of truth, see PlanProgress).
        var progress = s.progress();
        return new PublicPlanPortalView(
                MerchantView.from(s.merchant()),
                BookingView.from(s.booking()),
                PlanView.from(s.plan()),
                s.schedule().stream().map(ScheduleEntryView::from).toList(),
                CardView.from(s.card()),
                s.processingFeeCents(),
                progress.paidCents(),
                progress.remainingCents(),
                progress.nextDueDate(),
                progress.nextDueAmountCents(),
                progress.complete(),
                new StripeStateView(stripeService.isConfigured(), stripeService.publishableKey()));
    }

    public record MerchantView(
            String slug,
            String businessName,
            String businessType,
            String brandColorPrimary,
            String logoUrl,
            String contactEmail
    ) {
        static MerchantView from(Merchant m) {
            return new MerchantView(
                    m.slug(),
                    m.businessName(),
                    m.businessType(),
                    null, // brandColorPrimary — not on the domain record yet
                    null, // logoUrl — not on the domain record yet
                    m.email());
        }
    }

    public record BookingView(
            String serviceName,
            String description,
            LocalDate appointmentDate,
            LocalDate checkoutDate,
            long totalAmountCents,
            Long originalTotalAmountCents,
            String customerNameHint,
            String customerEmailHint
    ) {
        static BookingView from(Booking b) {
            return new BookingView(
                    b.serviceName(),
                    b.serviceDescription(),
                    b.appointmentDate(),
                    b.checkoutDate(),
                    b.totalAmountCents(),
                    b.originalTotalAmountCents(),
                    b.customerNameHint(),
                    b.customerEmailHint());
        }
    }

    public record PlanView(
            String id,
            String frequency,
            int numPayments,
            long totalAmountCents,
            long depositAmountCents,
            String status,
            LocalDate startDate,
            LocalDate endDate,
            Instant refundedAt,
            Long refundAmountCents
    ) {
        static PlanView from(PaymentPlan p) {
            return new PlanView(
                    p.id().toString(),
                    p.frequency().wire(),
                    p.numPayments(),
                    p.totalAmountCents(),
                    p.depositAmountCents(),
                    p.status().wire(),
                    p.startDate(),
                    p.endDate(),
                    p.refundedAt(),
                    p.refundAmountCents());
        }
    }

    public record ScheduleEntryView(
            int sequence,
            LocalDate dueDate,
            long amountCents,
            String status,
            String kind,
            String stripePaymentIntentId,
            Instant paidAt
    ) {
        static ScheduleEntryView from(PaymentScheduleEntry e) {
            return new ScheduleEntryView(
                    e.sequence(),
                    e.dueDate(),
                    e.amountCents(),
                    e.status().wire(),
                    e.kind().wire(),
                    e.stripePaymentIntentId(),
                    e.paidAt());
        }
    }

    public record CardView(
            String brand,
            String lastFour,
            int expMonth,
            int expYear
    ) {
        static CardView from(CustomerCard c) {
            if (c == null) return null;
            return new CardView(c.brand(), c.lastFour(), c.expMonth(), c.expYear());
        }
    }

    public record StripeStateView(boolean configured, String publishableKey) {}
}
