package com.bliss.b2b.service;

/**
 * A recoverable onboarding failure the API surfaces to the property with a
 * stable {@code code} and a human message (e.g. a failed Mews validation, or
 * activating before setup is complete).
 */
public class PropertyOnboardingException extends RuntimeException {

    private final String code;

    public PropertyOnboardingException(String code, String message) {
        super(message);
        this.code = code;
    }

    public String code() {
        return code;
    }
}
