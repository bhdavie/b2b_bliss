package com.bliss.b2b.payments;

/**
 * What the system does when the merchant's retry policy is exhausted.
 *
 * <ul>
 *   <li>{@code CANCEL_FORFEIT} — booking canceled, paid installments stay
 *       with the merchant.
 *   <li>{@code CANCEL_REFUND} — booking canceled, paid installments refunded.
 *   <li>{@code MARK_DEFAULTED} — leave the plan in {@code defaulted}; merchant
 *       resolves manually. This is the default and the safest baseline.
 *   <li>{@code CONVERT_TO_CREDIT} — paid amount becomes customer credit for
 *       future bookings with this merchant.
 *   <li>{@code BALANCE_DUE_AT_ARRIVAL} — keep the booking active, end the
 *       payment plan, customer settles the remaining balance with the
 *       merchant directly at the appointment.
 * </ul>
 */
public enum AfterRetriesAction {
    CANCEL_FORFEIT("cancel_forfeit"),
    CANCEL_REFUND("cancel_refund"),
    MARK_DEFAULTED("mark_defaulted"),
    CONVERT_TO_CREDIT("convert_to_credit"),
    BALANCE_DUE_AT_ARRIVAL("balance_due_at_arrival");

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
