package com.bliss.b2b.payments;

/** Whether a booking can be cancelled for money back (configurable-property spec, section 3). */
public enum BookingType {
    /** The guest can cancel and get money back up to a deadline; then a penalty may apply. */
    REFUNDABLE("refundable"),
    /** Nothing is refunded once booked. */
    NON_REFUNDABLE("non_refundable");

    private final String wire;

    BookingType(String wire) {
        this.wire = wire;
    }

    public String wire() {
        return wire;
    }

    public static BookingType fromWire(String wire) {
        for (BookingType t : values()) {
            if (t.wire.equals(wire)) return t;
        }
        throw new IllegalArgumentException("Unknown booking type: " + wire);
    }
}
