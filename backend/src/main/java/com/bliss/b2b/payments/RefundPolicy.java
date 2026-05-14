package com.bliss.b2b.payments;

public enum RefundPolicy {
    FULL("full"),
    NONE("none"),
    FIRST_INSTALLMENT_ONLY("first_installment_only"),
    SLIDING_SCALE("sliding_scale"),
    CREDIT_ONLY("credit_only");

    private final String wire;

    RefundPolicy(String wire) {
        this.wire = wire;
    }

    public String wire() {
        return wire;
    }

    public static RefundPolicy fromWire(String wire) {
        for (RefundPolicy p : values()) {
            if (p.wire.equals(wire)) return p;
        }
        throw new IllegalArgumentException("Unknown refund policy: " + wire);
    }
}
