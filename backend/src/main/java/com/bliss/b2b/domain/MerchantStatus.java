package com.bliss.b2b.domain;

public enum MerchantStatus {
    PENDING_VERIFICATION("pending_verification"),
    ACTIVE("active"),
    SUSPENDED("suspended");

    private final String wire;

    MerchantStatus(String wire) {
        this.wire = wire;
    }

    public String wire() {
        return wire;
    }

    public static MerchantStatus fromWire(String wire) {
        for (MerchantStatus s : values()) {
            if (s.wire.equals(wire)) return s;
        }
        throw new IllegalArgumentException("Unknown merchant status: " + wire);
    }
}
