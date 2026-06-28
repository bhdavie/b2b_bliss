package com.bliss.b2b.service;

import java.time.LocalDate;
import java.util.List;

/**
 * As-of-today derivation of plan progress from the installment schedule. Single
 * source of truth shared by the /account list and the /plan portal so the
 * numbers reconcile across every screen.
 *
 * <p>Display/derivation only: every installment whose due date is on or before
 * {@code today} is treated as paid on time. No rows are written, no charges are
 * synthesized; this never touches Stripe or the database.
 */
public final class PlanProgress {

    private PlanProgress() {}

    public record Row(LocalDate dueDate, long amountCents) {}

    public record Snapshot(
            long paidCents,
            long remainingCents,
            int paidCount,
            int upcomingCount,
            LocalDate nextDueDate,
            Long nextDueAmountCents,
            boolean complete
    ) {}

    /**
     * @param rows               every schedule row (due date + amount)
     * @param totalWithFeeCents  what the customer pays in full (plan total + fee)
     * @param today              server date to evaluate against
     * @param planStatus         wire status of the plan ('active', 'completed',
     *                           'canceled', ...). Terminal states win over the
     *                           date rule: a completed plan is fully paid with no
     *                           upcoming payment; a canceled plan never surfaces a
     *                           next payment. The as-of-today rule applies to the
     *                           in-flight (active) case, which is the bug being
     *                           fixed.
     */
    public static Snapshot asOf(
            List<Row> rows, long totalWithFeeCents, LocalDate today, String planStatus) {
        if ("completed".equals(planStatus)) {
            return new Snapshot(
                    totalWithFeeCents, 0L, rows.size(), 0, null, null, true);
        }

        long paidCents = 0L;
        int paidCount = 0;
        int upcomingCount = 0;
        Row next = null;
        for (Row r : rows) {
            if (!r.dueDate().isAfter(today)) {
                // Due on or before today -> treated as paid on time.
                paidCents += r.amountCents();
                paidCount++;
            } else {
                upcomingCount++;
                if (next == null || r.dueDate().isBefore(next.dueDate())) {
                    next = r;
                }
            }
        }
        long remainingCents = Math.max(0L, totalWithFeeCents - paidCents);

        if ("canceled".equals(planStatus)) {
            // Canceled plans are terminal: never offer an upcoming payment and
            // never read as complete (they live in history under "cancelled").
            return new Snapshot(
                    paidCents, remainingCents, paidCount, 0, null, null, false);
        }

        boolean complete = !rows.isEmpty() && upcomingCount == 0;
        return new Snapshot(
                paidCents,
                remainingCents,
                paidCount,
                upcomingCount,
                next == null ? null : next.dueDate(),
                next == null ? null : next.amountCents(),
                complete);
    }
}
