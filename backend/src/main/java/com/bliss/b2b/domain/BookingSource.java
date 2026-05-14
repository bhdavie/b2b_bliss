package com.bliss.b2b.domain;

/**
 * Where the booking originated.
 *
 * <ul>
 *   <li>{@code MERCHANT_INITIATED} — created in the merchant dashboard's
 *       "New booking" form. The merchant shares the resulting
 *       {@code pay.bliss.com/{slug}/{token}} link with their customer.
 *   <li>{@code CUSTOMER_INITIATED} — created by the customer landing at
 *       {@code /checkout/{slug}} from the merchant's own checkout page,
 *       with the cart details in the URL. The merchant manually mirrors
 *       the booking into their own back-office system off-platform.
 * </ul>
 */
public enum BookingSource {
    MERCHANT_INITIATED("merchant_initiated"),
    CUSTOMER_INITIATED("customer_initiated");

    private final String wire;

    BookingSource(String wire) {
        this.wire = wire;
    }

    public String wire() {
        return wire;
    }

    public static BookingSource fromWire(String wire) {
        for (BookingSource s : values()) {
            if (s.wire.equals(wire)) return s;
        }
        throw new IllegalArgumentException("Unknown booking source: " + wire);
    }
}
