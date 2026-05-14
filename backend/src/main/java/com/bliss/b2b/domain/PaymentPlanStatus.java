package com.bliss.b2b.domain;

/**
 * Plan state machine (see {@code com.bliss.b2b.service.PaymentPlanStateMachine}
 * for the allowed transitions).
 *
 * <ul>
 *   <li>{@code ACTIVE} — plan in good standing. Initial state on accept.
 *   <li>{@code PAYMENT_FAILED_IN_RETRY} — at least one installment failed and
 *       the merchant's retry policy still has attempts remaining.
 *   <li>{@code PAYMENT_FAILED_EXHAUSTED} — retry policy is spent. The
 *       merchant's {@link com.bliss.b2b.payments.AfterRetriesAction}
 *       transitions the plan to either {@code BALANCE_DUE} (booking
 *       still on) or {@code CANCELED} (cancellation handler fires).
 *   <li>{@code BALANCE_DUE} — booking still on; remaining balance owed
 *       to the merchant at the appointment. Payment plan is paused.
 *   <li>{@code COMPLETED} — every installment cleared.
 *   <li>{@code DEFAULTED} — reachable only via the merchant's manual
 *       override (admin escape hatch). No automated path lands here.
 *   <li>{@code CANCELED} — customer or merchant ended the plan; the
 *       cancellation handler ran.
 * </ul>
 */
public enum PaymentPlanStatus {
    ACTIVE("active"),
    PAYMENT_FAILED_IN_RETRY("payment_failed_in_retry"),
    PAYMENT_FAILED_EXHAUSTED("payment_failed_exhausted"),
    BALANCE_DUE("balance_due"),
    COMPLETED("completed"),
    DEFAULTED("defaulted"),
    CANCELED("canceled");

    private final String wire;

    PaymentPlanStatus(String wire) {
        this.wire = wire;
    }

    public String wire() {
        return wire;
    }

    public static PaymentPlanStatus fromWire(String wire) {
        for (PaymentPlanStatus s : values()) {
            if (s.wire.equals(wire)) return s;
        }
        throw new IllegalArgumentException("Unknown payment plan status: " + wire);
    }

    /** True for states the merchant might want to act on from the dashboard. */
    public boolean needsAttention() {
        return this == PAYMENT_FAILED_IN_RETRY
                || this == PAYMENT_FAILED_EXHAUSTED
                || this == DEFAULTED
                || this == BALANCE_DUE;
    }

    /** Active = plan still consuming installment cadence (not yet final). */
    public boolean isOpen() {
        return this == ACTIVE
                || this == PAYMENT_FAILED_IN_RETRY
                || this == PAYMENT_FAILED_EXHAUSTED;
    }
}
