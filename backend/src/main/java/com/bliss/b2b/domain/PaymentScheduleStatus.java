package com.bliss.b2b.domain;

public enum PaymentScheduleStatus {
    SCHEDULED("scheduled"),
    PROCESSING("processing"),
    PAID("paid"),
    FAILED("failed"),
    RETRYING("retrying"),
    CANCELED("canceled");

    private final String wire;

    PaymentScheduleStatus(String wire) {
        this.wire = wire;
    }

    public String wire() {
        return wire;
    }

    public static PaymentScheduleStatus fromWire(String wire) {
        for (PaymentScheduleStatus s : values()) {
            if (s.wire.equals(wire)) return s;
        }
        throw new IllegalArgumentException("Unknown payment schedule status: " + wire);
    }
}
