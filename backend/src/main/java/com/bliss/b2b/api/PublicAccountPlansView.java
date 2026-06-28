package com.bliss.b2b.api;

import com.bliss.b2b.persistence.PaymentPlanDao.PaymentPlanListItem;
import com.bliss.b2b.persistence.PaymentPlanDao.PlanScheduleSummary;
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
            Map<java.util.UUID, PlanScheduleSummary> summaryByPlan
    ) {
        // Each plan carries its own resolved fee: 5% for plans created after the
        // fee migration, the legacy flat fee for backfilled ones. The top-level
        // processingFeeCents is deprecated now that fees are per-plan; the
        // frontend reads each card's totalWithFeeCents instead.
        List<PlanCardView> cards = items.stream()
                .map(item -> PlanCardView.from(
                        item, summaryByPlan.get(item.id()), item.processingFeeCents()))
                .toList();
        return new PublicAccountPlansView(email, 0L, cards);
    }

    public record PlanCardView(
            String planId,
            String bookingToken,
            String status,
            String merchantSlug,
            String merchantBusinessName,
            String serviceName,
            LocalDate appointmentDate,
            LocalDate checkoutDate,
            long totalAmountCents,          // discounted (plan total)
            Long originalTotalAmountCents,  // pre-discount (booking original)
            long totalWithFeeCents,         // what customer actually pays
            int numPayments,
            String frequency,
            int paidCount,
            int scheduledCount,
            LocalDate nextDueDate,
            Long nextDueAmountCents
    ) {
        static PlanCardView from(
                PaymentPlanListItem item,
                PlanScheduleSummary summary,
                long processingFeeCents
        ) {
            int paid = summary == null ? 0 : summary.paidCount();
            int scheduled = summary == null ? 0 : summary.scheduledCount();
            LocalDate nextDate = summary == null ? null : summary.nextDueDate();
            Long nextAmount = summary == null ? null : summary.nextDueAmountCents();
            return new PlanCardView(
                    item.id().toString(),
                    item.bookingToken(),
                    item.status(),
                    item.merchantSlug(),
                    item.merchantBusinessName(),
                    item.serviceName(),
                    item.appointmentDate(),
                    item.checkoutDate(),
                    item.totalAmountCents(),
                    item.originalTotalCents(),
                    item.totalAmountCents() + processingFeeCents,
                    item.numPayments(),
                    item.frequency(),
                    paid,
                    scheduled,
                    nextDate,
                    nextAmount);
        }
    }
}
