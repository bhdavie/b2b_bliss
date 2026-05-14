package com.bliss.b2b.domain;

public enum BookingStatus {
    DRAFT("draft"),
    SENT("sent"),
    ACCEPTED("accepted"),
    IN_PROGRESS("in_progress"),
    COMPLETED("completed"),
    CANCELED("canceled");

    private final String wire;

    BookingStatus(String wire) {
        this.wire = wire;
    }

    public String wire() {
        return wire;
    }

    public static BookingStatus fromWire(String wire) {
        for (BookingStatus s : values()) {
            if (s.wire.equals(wire)) return s;
        }
        throw new IllegalArgumentException("Unknown booking status: " + wire);
    }
}
