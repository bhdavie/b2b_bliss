package com.bliss.b2b.domain;

/**
 * Distinguishes a deposit row from an installment row on a {@code payment_schedule}.
 * Deposits fire on plan acceptance; installments fire on the chosen cadence
 * over the post-deposit balance.
 */
public enum ScheduleKind {
    DEPOSIT("deposit"),
    INSTALLMENT("installment");

    private final String wire;

    ScheduleKind(String wire) {
        this.wire = wire;
    }

    public String wire() {
        return wire;
    }

    public static ScheduleKind fromWire(String wire) {
        for (ScheduleKind k : values()) {
            if (k.wire.equals(wire)) return k;
        }
        throw new IllegalArgumentException("Unknown schedule kind: " + wire);
    }
}
