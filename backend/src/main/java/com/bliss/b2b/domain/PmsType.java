package com.bliss.b2b.domain;

/**
 * Which rail a property runs its charges on. {@link #NONE} is the default and
 * means the property has not picked one yet. {@link #MEWS} charges through the
 * Mews Connector API with the property's own credentials. {@link #CLOUDBEDS}
 * connects via OAuth 2.0 and charges through the Cloudbeds API with the
 * property's own tokens. {@link #STRIPE} is the legacy no-PMS rail: charges run
 * on the Bliss platform account directly.
 *
 * <p>NONE replaced STRIPE as the default. STRIPE was a poor default because it
 * is not offered in the onboarding funnel — the PMS step lists Mews and
 * Cloudbeds only — while the state machine still required a charges-enabled
 * Connect account to leave PMS_CONNECTED. A property that signed up and stopped
 * before choosing was therefore parked on a rail it could not complete and
 * could not see. NONE has no connect step to be stranded in front of: it simply
 * means "has not chosen", so the only way out is the PMS step, which is exactly
 * where such a property belongs.
 *
 * <p>STRIPE is retained rather than deleted because existing properties run on
 * it (the seeded Marbrook Lodge demo among them) and it is still a valid
 * charging rail in {@code PlanCreationService}. It is simply no longer
 * reachable by a new property.
 */
public enum PmsType {
    /** No rail chosen yet. The default for a new property. */
    NONE("none"),
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

    /**
     * True for PMS types a property can actually connect to in this build.
     * NONE is not connectable (there is nothing to connect), and STRIPE is no
     * longer offered in the funnel.
     */
    public boolean isConnectable() {
        return this == MEWS || this == CLOUDBEDS;
    }

    /**
     * A null wire value means "not chosen" and maps to {@link #NONE}. It used to
     * fall back to STRIPE, which silently put every rail-less property on the
     * Stripe rail; see the class note above for why that was wrong.
     */
    public static PmsType fromWire(String wire) {
        if (wire == null) {
            return NONE;
        }
        for (PmsType t : values()) {
            if (t.wire.equals(wire)) {
                return t;
            }
        }
        throw new IllegalArgumentException("Unknown pms type: " + wire);
    }
}
