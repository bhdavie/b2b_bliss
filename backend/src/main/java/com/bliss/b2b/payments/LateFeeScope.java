package com.bliss.b2b.payments;

public enum LateFeeScope {
    PER_FAILURE("per_failure"),
    ONCE_PER_PLAN("once_per_plan");

    private final String wire;

    LateFeeScope(String wire) {
        this.wire = wire;
    }

    public String wire() {
        return wire;
    }

    public static LateFeeScope fromWire(String wire) {
        for (LateFeeScope s : values()) {
            if (s.wire.equals(wire)) return s;
        }
        throw new IllegalArgumentException("Unknown late fee scope: " + wire);
    }
}
