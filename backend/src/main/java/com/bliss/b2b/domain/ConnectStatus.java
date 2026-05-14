package com.bliss.b2b.domain;

public enum ConnectStatus {
    NOT_STARTED("not_started"),
    IN_PROGRESS("in_progress"),
    CHARGES_ENABLED("charges_enabled"),
    RESTRICTED("restricted");

    private final String wire;

    ConnectStatus(String wire) {
        this.wire = wire;
    }

    public String wire() {
        return wire;
    }

    public static ConnectStatus fromWire(String wire) {
        if (wire == null) return NOT_STARTED;
        for (ConnectStatus s : values()) {
            if (s.wire.equals(wire)) return s;
        }
        return NOT_STARTED;
    }
}
