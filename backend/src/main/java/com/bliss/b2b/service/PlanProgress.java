package com.bliss.b2b.service;

import java.time.LocalDate;
import java.util.List;

/**
 * Plan progress derived from the installment schedule. Single source of truth
 * shared by the /account list and the /plan portal so the numbers reconcile
 * across every screen.
 *
 * <p>Progress follows each row's OWN status, never its due date. A row counts as
 * paid when its status is {@code paid} — i.e. when a charge actually settled
 * against it — so a row dated in the future that has been paid counts, and a row
 * dated in the past that has not been charged does not. The previous rule
 * ("every row due on or before today is treated as paid on time") inferred
 * payment from the calendar, which disagreed with the schedule's own PAID labels
 * whenever the two diverged: a plan whose dates had been moved forward showed
 * three paid installments alongside a zero paid-to-date figure.
 *
 * <p>{@code canceled} and {@code failed} rows are not paid. A canceled row is
 * also not outstanding — it is struck from the plan, so it never surfaces as the
 * next payment. A failed row is still owed and remains eligible to be the next
 * payment, since it will be retried.
 *
 * <p>Display/derivation only: no rows are written, no charges are synthesized;
 * this never touches Stripe or the database.
 */
public final class PlanProgress {

    private PlanProgress() {}

    private static final String PAID = "paid";
    private static final String CANCELED = "canceled";

    /**
     * @param dueDate     when the row is due
     * @param amountCents the row's amount
     * @param status      the row's own wire status ('scheduled', 'processing',
     *                    'paid', 'failed', 'retrying', 'canceled')
     */
    public record Row(LocalDate dueDate, long amountCents, String status) {}

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
     * @param rows               every schedule row (due date + amount + status)
     * @param totalWithFeeCents  what the customer pays in full (plan total + fee)
     * @param today              retained for call-site compatibility and no
     *                           longer read: progress comes from row status, not
     *                           from the date. Kept so the two callers do not
     *                           have to change signature alongside this fix.
     * @param planStatus         wire status of the plan ('active', 'completed',
     *                           'canceled', ...). Terminal states win over the
     *                           row rule: a completed plan is fully paid with no
     *                           upcoming payment; a canceled plan never surfaces
     *                           a next payment.
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
            if (PAID.equals(r.status())) {
                paidCents += r.amountCents();
                paidCount++;
            } else if (!CANCELED.equals(r.status())) {
                // Anything not paid and not struck from the plan is still owed:
                // scheduled, processing, failed and retrying all qualify, and the
                // earliest of them by due date is the next payment.
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

        // Complete means every row settled, not that the calendar passed the
        // last due date. A plan carrying a canceled row is therefore not
        // complete, which is what the modification flow already implies.
        boolean complete = !rows.isEmpty() && paidCount == rows.size();
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
