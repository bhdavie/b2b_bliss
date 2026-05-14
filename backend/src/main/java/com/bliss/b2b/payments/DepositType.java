package com.bliss.b2b.payments;

public enum DepositType {
    PERCENTAGE("percentage"),
    FIXED("fixed");

    private final String wire;

    DepositType(String wire) {
        this.wire = wire;
    }

    public String wire() {
        return wire;
    }

    public static DepositType fromWire(String wire) {
        for (DepositType t : values()) {
            if (t.wire.equals(wire)) return t;
        }
        throw new IllegalArgumentException("Unknown deposit type: " + wire);
    }
}
