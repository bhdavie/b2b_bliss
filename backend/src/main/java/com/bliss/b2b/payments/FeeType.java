package com.bliss.b2b.payments;

/**
 * Type tag shared by cancellation fees and late fees. {@code FIXED} means
 * the value is integer cents; {@code PERCENTAGE} means the value is an
 * integer percent (1-100).
 */
public enum FeeType {
    FIXED("fixed"),
    PERCENTAGE("percentage");

    private final String wire;

    FeeType(String wire) {
        this.wire = wire;
    }

    public String wire() {
        return wire;
    }

    public static FeeType fromWire(String wire) {
        for (FeeType t : values()) {
            if (t.wire.equals(wire)) return t;
        }
        throw new IllegalArgumentException("Unknown fee type: " + wire);
    }
}
