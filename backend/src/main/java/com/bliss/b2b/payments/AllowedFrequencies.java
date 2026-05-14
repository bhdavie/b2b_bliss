package com.bliss.b2b.payments;

import java.util.List;

public enum AllowedFrequencies {
    MONTHLY("monthly"),
    BIWEEKLY("biweekly"),
    BOTH("both");

    private final String wire;

    AllowedFrequencies(String wire) {
        this.wire = wire;
    }

    public String wire() {
        return wire;
    }

    public List<PlanFrequency> frequencies() {
        return switch (this) {
            case MONTHLY -> List.of(PlanFrequency.MONTHLY);
            case BIWEEKLY -> List.of(PlanFrequency.BIWEEKLY);
            case BOTH -> List.of(PlanFrequency.BIWEEKLY, PlanFrequency.MONTHLY);
        };
    }

    public boolean includes(PlanFrequency frequency) {
        return frequencies().contains(frequency);
    }

    public static AllowedFrequencies fromWire(String wire) {
        for (AllowedFrequencies f : values()) {
            if (f.wire.equals(wire)) return f;
        }
        throw new IllegalArgumentException("Unknown allowed_frequencies: " + wire);
    }
}
