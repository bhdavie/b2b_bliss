package com.bliss.b2b.payments;

/**
 * What a guest's cancellation does with the money collected so far
 * (configurable-property spec, section 3.2), for a booking that kept its
 * booking type and cancellation terms. Amounts are minor units of the
 * booking's currency.
 *
 * <ul>
 *   <li>Refundable, before the free cancellation deadline: everything back,
 *       the Bliss fee included.
 *   <li>Refundable, after it: the hotel's policy fee is kept (never more
 *       than was collected) and the rest goes back. The Bliss fee is kept as
 *       part of that penalty, not on top of it (spec D9, pay as you go).
 *   <li>Non-refundable: nothing goes back.
 * </ul>
 *
 * In every case the remaining payments stop (spec D7, proposed default).
 * Whether "back" means a card refund or future-stay credit depends on the
 * payment rail and is decided by the caller.
 */
public record CancellationOutcome(Kind kind, long collectedMinor, long returnedMinor, long keptByPropertyMinor,
        long keptBlissFeeMinor) {

    public enum Kind {
        /** Before the free cancellation deadline: everything goes back. */
        FULL_REFUND,
        /** After it: the hotel's fee and the Bliss fee are kept, the rest goes back. */
        PENALTY,
        /** Non-refundable: what was paid is kept. */
        FORFEIT
    }

    /**
     * @param collectedMinor what the guest has paid so far, the Bliss fee share included
     * @param blissFeeMinor  the plan's Bliss fee
     * @param penaltyMinor   the hotel policy's fee at the moment of cancelling, which
 *                       includes the Bliss fee
     */
    public static CancellationOutcome of(BookingType type, boolean beforeDeadline, long collectedMinor,
            long blissFeeMinor, long penaltyMinor) {
        long collected = Math.max(0L, collectedMinor);
        if (type == BookingType.NON_REFUNDABLE) {
            return new CancellationOutcome(Kind.FORFEIT, collected, 0L, collected, 0L);
        }
        if (beforeDeadline) {
            return new CancellationOutcome(Kind.FULL_REFUND, collected, collected, 0L, 0L);
        }
        long kept = Math.min(collected, Math.max(0L, penaltyMinor));
        long fee = Math.min(kept, Math.max(0L, blissFeeMinor));
        return new CancellationOutcome(Kind.PENALTY, collected, collected - kept, kept - fee, fee);
    }
}
