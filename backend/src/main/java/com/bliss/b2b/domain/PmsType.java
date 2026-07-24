package com.bliss.b2b.domain;

/**
 * Which rail a property runs its charges on. {@link #STRIPE} is the default and
 * needs no PMS connection. {@link #MEWS} charges through the Mews Connector API
 * with the property's own credentials. {@link #CLOUDBEDS} connects via OAuth 2.0
 * and charges through the Cloudbeds API with the property's own tokens.
 */
public enum PmsType {
    STRIPE("stripe"),
    MEWS("mews"),
    CLOUDBEDS("cloudbeds");

    private final String wire;

    PmsType(String wire) {
        this.wire = wire;
    }

    public String wire() {
        return wire;
    }

    /** True for PMS types a property can actually connect to in this build. */
    public boolean isConnectable() {
        return this == STRIPE || this == MEWS || this == CLOUDBEDS;
    }

    public static PmsType fromWire(String wire) {
        if (wire == null) {
            return STRIPE;
        }
        for (PmsType t : values()) {
            if (t.wire.equals(wire)) {
                return t;
            }
        }
        throw new IllegalArgumentException("Unknown pms type: " + wire);
    }
}
