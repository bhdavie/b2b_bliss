package com.bliss.b2b.payments;

/**
 * Hold mode: when held money is released to the property (spec section 2.3).
 * A release point is the moment an amount stops being refundable, so the
 * property never holds money it might have to give back.
 */
public enum ReleasePolicy {
    /** At the end of the free cancellation window; later payments as each settles. */
    CANCELLATION_DEADLINE("cancellation_deadline"),
    /** Everything on arrival day, in the property's zone. */
    CHECK_IN("check_in"),
    /** Each payment once it settles plus the chargeback buffer. */
    ON_COLLECTION("on_collection");

    private final String wire;

    ReleasePolicy(String wire) {
        this.wire = wire;
    }

    public String wire() {
        return wire;
    }

    public static ReleasePolicy fromWire(String wire) {
        for (ReleasePolicy p : values()) {
            if (p.wire.equals(wire)) return p;
        }
        throw new IllegalArgumentException("Unknown release policy: " + wire);
    }
}
