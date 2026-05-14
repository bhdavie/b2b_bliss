package com.bliss.b2b.integration;

public class StripeNotConfiguredException extends RuntimeException {
    public StripeNotConfiguredException() {
        super("Stripe is not configured. Set STRIPE_SECRET_KEY to enable Connect onboarding.");
    }
}
