package com.bliss.b2b.domain;

public enum PaymentPlanStatus {
    ACTIVE("active"),
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
}
