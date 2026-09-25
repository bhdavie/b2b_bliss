package com.bliss.b2b.integration.pms;

import java.time.Duration;

/**
 * The parts of a property's Mews catalogue Bliss books against, as read from
 * services/getAll, rates/getAll and resourceCategories/getAll. Plain values;
 * nothing here calls Mews.
 */
public final class MewsCatalog {

    private MewsCatalog() {
    }

    /**
     * A bookable (stay) service. The offsets are Mews' check-in and check-out
     * times, measured from local midnight of the arrival and departure dates.
     */
    public record Service(String id, String name, boolean active, Duration startOffset, Duration endOffset) {
    }

    /** A rate on a service. Bliss books a private one with no payment policy. */
    public record Rate(String id, String name, String type, boolean isPublic, boolean enabled, boolean active) {
        /**
         * Enabled, active, and not an availability-block rate. Block rates belong
         * to a group allotment and need an AvailabilityBlockId to book, which a
         * guest checkout never has.
         */
        public boolean bookable() {
            return enabled && active && !"AvailabilityBlock".equals(type);
        }
    }

    /**
     * A room category. {@code capacity} is standard occupancy (beds);
     * {@code extraCapacity} is extra beds, which Mews prices separately.
     */
    public record ResourceCategory(String id, String name, boolean active, int capacity, int extraCapacity) {
    }
}
