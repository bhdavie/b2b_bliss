package com.bliss.b2b.service;

import java.security.SecureRandom;
import java.util.UUID;

/**
 * Synthetic Stripe-shaped identifiers for the demo-mode persistence path.
 * All values are prefixed with the Stripe object prefix followed by
 * {@code _demo_} so they are immediately distinguishable from real Stripe
 * IDs both at a glance and via grep. Used only from the demo arms of
 * {@link PlanCreationService} and {@link PlanPortalService}.
 */
final class StripeIds {

    private static final SecureRandom RNG = new SecureRandom();

    private StripeIds() {}

    static String customerId() {
        return "cus_demo_" + shortHex();
    }

    static String paymentMethodId() {
        return "pm_demo_" + shortHex();
    }

    static String setupIntentId() {
        return "seti_demo_" + shortHex();
    }

    /**
     * Deterministically maps a schedule row id to a paymentintent-shaped id so
     * the DB row's pi_demo_xxxxxxxx can be traced back to the row it represents
     * when reading raw tables.
     */
    static String intentIdFor(UUID scheduleRowId) {
        return "pi_demo_" + scheduleRowId.toString().replace("-", "").substring(0, 12);
    }

    private static String shortHex() {
        long n = RNG.nextLong();
        // Mask the sign and zero-pad so the result is always 12 hex chars.
        return String.format("%012x", n & 0xFFFFFFFFFFFFL);
    }
}
