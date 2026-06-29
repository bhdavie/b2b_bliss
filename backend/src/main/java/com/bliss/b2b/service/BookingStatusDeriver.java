package com.bliss.b2b.service;

import com.bliss.b2b.persistence.PaymentPlanDao.BookingStatusInputs;
import java.time.LocalDate;

/**
 * Derives the merchant Bookings-table status from real booking + plan +
 * schedule data, as-of a given date. Priority order, first match wins:
 *
 * <ol>
 *   <li>cancelled — booking or its plan was cancelled/defaulted.</li>
 *   <li>booking_complete — check-in has passed (terminal; beats payments).</li>
 *   <li>payments_complete — all installments paid, trip still in the future.</li>
 *   <li>late — plan in progress with an overdue (past-due, unpaid) payment.</li>
 *   <li>active — plan in progress, on track, trip in the future.</li>
 *   <li>other — anything else (e.g. a sent booking with no plan yet).</li>
 * </ol>
 */
public final class BookingStatusDeriver {

    private BookingStatusDeriver() {}

    public static String derive(BookingStatusInputs in, LocalDate today) {
        String planStatus = in.planStatus();
        boolean cancelledPlan = "canceled".equals(planStatus) || "defaulted".equals(planStatus);
        if ("canceled".equals(in.bookingStatus()) || cancelledPlan) {
            return "cancelled";
        }
        if (in.checkInDate() != null && today.isAfter(in.checkInDate())) {
            return "booking_complete";
        }
        boolean hasPlan = planStatus != null;
        if (hasPlan) {
            int numPayments = in.numPayments() == null ? 0 : in.numPayments();
            long paid = in.paidCount() == null ? 0 : in.paidCount();
            boolean allPaid = numPayments > 0 && paid >= numPayments;
            if ("completed".equals(planStatus) || allPaid) {
                return "payments_complete";
            }
            long overdue = in.overdueCount() == null ? 0 : in.overdueCount();
            return overdue > 0 ? "late" : "active";
        }
        return "other";
    }
}
