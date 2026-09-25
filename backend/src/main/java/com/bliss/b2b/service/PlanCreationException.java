package com.bliss.b2b.service;

/**
 * Raised when {@link PlanCreationService#createPlan} cannot complete. The
 * {@link #reason} is a stable wire code the public resource maps to an HTTP
 * status; {@link #getMessage} is safe to surface to the consumer.
 */
public class PlanCreationException extends RuntimeException {

    public enum Reason {
        BOOKING_NOT_FOUND,
        BOOKING_NOT_OPEN,
        ELIGIBILITY_FAILED,
        MERCHANT_NOT_READY,
        STRIPE_NOT_CONFIGURED,
        CARD_DECLINED,
        CARD_REQUIRES_ACTION,
        STRIPE_ERROR,
        INVALID_INPUT,
        /** The Mews room is no longer free for those dates. */
        STAY_UNAVAILABLE,
        /** The property's Mews could not be reached to price or book the stay. */
        PMS_UNAVAILABLE
    }

    private final Reason reason;

    public PlanCreationException(Reason reason, String message) {
        super(message);
        this.reason = reason;
    }

    public PlanCreationException(Reason reason, String message, Throwable cause) {
        super(message, cause);
        this.reason = reason;
    }

    public Reason reason() {
        return reason;
    }
}
