package com.bliss.b2b.persistence;

import java.time.LocalDate;
import java.util.UUID;
import org.jdbi.v3.sqlobject.customizer.Bind;
import org.jdbi.v3.sqlobject.statement.SqlUpdate;

/**
 * Mutations for the booking-modification / plan-recalculation flow, kept in
 * their own DAO so the charging-adjacent DAOs ({@link BookingDao},
 * {@link PaymentPlanDao}, {@link PaymentScheduleDao}) stay untouched. New
 * schedule rows are inserted via the existing {@link PaymentScheduleDao#insert}.
 *
 * <p>"Rebuildable" rows are exactly the {@code scheduled} and {@code retrying}
 * installments — the ones not yet collected. {@code paid} and {@code processing}
 * rows are never selected here, so they are immutable by construction.
 */
public interface PlanModificationDao {

    /** Deletes the not-yet-collected rows so they can be regenerated. */
    @SqlUpdate("""
            DELETE FROM payment_schedule
            WHERE payment_plan_id = :planId
              AND status IN ('scheduled', 'retrying')
            """)
    int deleteRebuildable(@Bind("planId") UUID planId);

    /** Cancels the not-yet-collected rows (used when nothing remains to collect). */
    @SqlUpdate("""
            UPDATE payment_schedule
            SET status = 'canceled'
            WHERE payment_plan_id = :planId
              AND status IN ('scheduled', 'retrying')
            """)
    int cancelRebuildable(@Bind("planId") UUID planId);

    /** Applies the booking's new dates and total atomically with the plan rebuild. */
    @SqlUpdate("""
            UPDATE bookings
            SET appointment_date = :appointmentDate,
                checkout_date = :checkoutDate,
                total_amount_cents = :totalAmountCents
            WHERE id = :bookingId
            """)
    int updateBookingDetails(
            @Bind("bookingId") UUID bookingId,
            @Bind("appointmentDate") LocalDate appointmentDate,
            @Bind("checkoutDate") LocalDate checkoutDate,
            @Bind("totalAmountCents") long totalAmountCents
    );

    /** Updates the plan's total, payment count, and end date after a rebuild. */
    @SqlUpdate("""
            UPDATE payment_plans
            SET total_amount_cents = :totalAmountCents,
                num_payments = :numPayments,
                end_date = :endDate
            WHERE id = :planId
            """)
    int updatePlanAfterModify(
            @Bind("planId") UUID planId,
            @Bind("totalAmountCents") long totalAmountCents,
            @Bind("numPayments") int numPayments,
            @Bind("endDate") LocalDate endDate
    );
}
