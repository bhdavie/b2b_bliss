package com.bliss.b2b.payments;

public enum PlanFrequency {
    BIWEEKLY(14, "biweekly"),
    MONTHLY(30, "monthly");

    private final int days;
    private final String wire;

    PlanFrequency(int days, String wire) {
        this.days = days;
        this.wire = wire;
    }

    public int days() {
        return days;
    }

    public String wire() {
        return wire;
    }

    public static PlanFrequency fromWire(String wire) {
        for (PlanFrequency f : values()) {
            if (f.wire.equals(wire)) return f;
        }
        throw new IllegalArgumentException("Unknown plan frequency: " + wire);
    }
}
