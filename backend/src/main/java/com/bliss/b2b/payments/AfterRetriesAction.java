package com.bliss.b2b.payments;

/**
 * What the system does when the merchant's retry policy is exhausted.
 * The five-option set from Phase 10 collapsed in Phase 12 to two
 * delegating choices that don't redefine refund/credit logic — the
 * configured {@link RefundPolicy} and cancellation fee handle that.
 *
 * <ul>
 *   <li>{@code BALANCE_DUE_AT_CHECKIN} — keep the booking active, move
 *       the plan to {@code BALANCE_DUE}. No refund issued, no fee. The
 *       customer settles the unpaid remainder when they arrive.
 *   <li>{@code TREAT_AS_CANCELLATION} — invoke the same cancellation
 *       handler used for a customer-initiated cancel, with
 *       {@code Instant.now()} as the cancellation timestamp. The
 *       merchant's Refund policy and Cancellation fee evaluate against
 *       that moment.
 * </ul>
 */
public enum AfterRetriesAction {
    BALANCE_DUE_AT_CHECKIN("balance_due_at_checkin"),
    TREAT_AS_CANCELLATION("treat_as_cancellation");

    private final String wire;

    AfterRetriesAction(String wire) {
        this.wire = wire;
    }

    public String wire() {
        return wire;
    }

    public static AfterRetriesAction fromWire(String wire) {
        for (AfterRetriesAction a : values()) {
            if (a.wire.equals(wire)) return a;
        }
        throw new IllegalArgumentException("Unknown after-retries action: " + wire);
    }
}
