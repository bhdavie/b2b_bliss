package com.bliss.b2b.payments;

import java.time.Duration;
import java.time.Instant;

/**
 * Hold mode: when a payment Bliss is holding becomes the property's
 * (configurable-property spec, section 2.3). A release point is the moment an
 * amount stops being refundable to the guest, so the property never holds money
 * it might have to give back.
 *
 * <ul>
 *   <li>{@link ReleasePolicy#CANCELLATION_DEADLINE} (default): a refundable
 *       booking releases at the end of free cancellation (arrival when the
 *       booking has no deadline), a payment settling after it as it settles;
 *       a non-refundable booking releases each payment on collection.
 *   <li>{@link ReleasePolicy#ON_COLLECTION}: each payment once it settles plus
 *       the chargeback buffer (D4).
 *   <li>{@link ReleasePolicy#CHECK_IN}: everything at arrival.
 * </ul>
 */
public final class ReleaseSchedule {

    private ReleaseSchedule() {
    }

    /**
     * @param bookingType  the booking's snapshotted type; null (made before
     *                     booking types) is treated as refundable
     * @param freeUntil    the booking's free cancellation deadline, or null
     * @param arrival      the stay's start
     * @param bufferDays   the property's chargeback buffer
     * @param paidAt       when the payment settled
     * @param maxHold      the longest Stripe lets the platform hold funds, or
     *                     null while unknown (D3)
     */
    public static Instant releaseAt(ReleasePolicy policy, BookingType bookingType, Instant freeUntil,
            Instant arrival, int bufferDays, Instant paidAt, Duration maxHold) {
        Instant onCollection = paidAt.plus(Duration.ofDays(Math.max(0, bufferDays)));
        Instant at = switch (policy) {
            case CHECK_IN -> arrival;
            case ON_COLLECTION -> onCollection;
            case CANCELLATION_DEADLINE -> bookingType == BookingType.NON_REFUNDABLE
                    ? onCollection
                    : later(freeUntil == null ? arrival : freeUntil, paidAt);
        };
        // TODO(D3): Stripe's maximum hold is unconfirmed. When it is set, a
        // payment is released no later than that, even before its point.
        if (maxHold != null && at.isAfter(paidAt.plus(maxHold))) {
            at = paidAt.plus(maxHold);
        }
        return at;
    }

    private static Instant later(Instant a, Instant b) {
        return a.isAfter(b) ? a : b;
    }
}
