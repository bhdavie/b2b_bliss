package com.bliss.b2b.payments;

/**
 * How a property is paid. {@link #PAY_AS_YOU_GO} charges each payment through
 * the property's own processor (Mews Payments, or a Stripe destination
 * charge), so the money lands with the property as it is collected.
 * {@link #HOLD} charges on the Bliss platform account and Stripe holds the
 * money until a release point, then Bliss releases it to the property's
 * connected account (configurable-property spec, section 2).
 */
public enum PayoutMode {
    PAY_AS_YOU_GO("pay_as_you_go"),
    HOLD("hold");

    private final String wire;

    PayoutMode(String wire) {
        this.wire = wire;
    }

    public String wire() {
        return wire;
    }

    public static PayoutMode fromWire(String wire) {
        for (PayoutMode m : values()) {
            if (m.wire.equals(wire)) return m;
        }
        throw new IllegalArgumentException("Unknown payout mode: " + wire);
    }
}
