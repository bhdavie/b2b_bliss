package com.bliss.b2b.api;

import com.bliss.b2b.persistence.PaymentPlanDao.PaymentPlanListItem;
import com.bliss.b2b.service.PlanProgress;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;

/**
 * Wire shape returned by {@code GET /api/v1/public/account/plans}. Each
 * card on the /account index reads directly from these fields — money
 * totals are derived server-side so the frontend has no math to do.
 */
public record PublicAccountPlansView(
        String email,
        long processingFeeCents,
        List<PlanCardView> plans
) {

    public static PublicAccountPlansView from(
            String email,
            List<PaymentPlanListItem> items,
            Map<java.util.UUID, PlanProgress.Snapshot> progressByPlan
    ) {
        // Money + next-payment are derived as-of-today by PlanProgress (single
        // source of truth shared with the portal). The top-level
        // processingFeeCents is deprecated now that fees are per-plan; the
        // frontend reads each card's totalWithFeeCents instead.
        List<PlanCardView> cards = items.stream()
                .map(item -> PlanCardView.from(item, progressByPlan.get(item.id())))
                .toList();
        return new PublicAccountPlansView(email, 0L, cards);
    }

    public record PlanCardView(
            String planId,
            String bookingToken,
            String status,
            boolean complete,               // all installments due on or before today
            String merchantSlug,
            String merchantBusinessName,
            String serviceName,
            LocalDate appointmentDate,
            LocalDate checkoutDate,
            long totalAmountCents,          // discounted (plan total)
            Long originalTotalAmountCents,  // pre-discount (booking original)
            long totalWithFeeCents,         // what customer actually pays
            long paidCents,                 // due on or before today
            long remainingCents,            // totalWithFee minus paid
            int numPayments,
            String frequency,
            int paidCount,
            int scheduledCount,
            LocalDate nextDueDate,
            Long nextDueAmountCents
    ) {
        static PlanCardView from(
                PaymentPlanListItem item,
                PlanProgress.Snapshot progress
        ) {
            long totalWithFeeCents = item.totalAmountCents() + item.processingFeeCents();
            long paidCents = progress == null ? 0L : progress.paidCents();
            long remainingCents = progress == null
                    ? totalWithFeeCents
                    : progress.remainingCents();
            int paidCount = progress == null ? 0 : progress.paidCount();
            int upcomingCount = progress == null ? 0 : progress.upcomingCount();
            boolean complete = progress != null && progress.complete();
            LocalDate nextDate = progress == null ? null : progress.nextDueDate();
            Long nextAmount = progress == null ? null : progress.nextDueAmountCents();
            return new PlanCardView(
                    item.id().toString(),
                    item.bookingToken(),
                    item.status(),
                    complete,
                    item.merchantSlug(),
                    item.merchantBusinessName(),
                    item.serviceName(),
                    item.appointmentDate(),
                    item.checkoutDate(),
                    item.totalAmountCents(),
                    item.originalTotalCents(),
                    totalWithFeeCents,
                    paidCents,
                    remainingCents,
                    item.numPayments(),
                    item.frequency(),
                    paidCount,
                    upcomingCount,
                    nextDate,
                    nextAmount);
        }
    }
}
