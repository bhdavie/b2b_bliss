package com.bliss.b2b.service;

/**
 * Thrown when a magic-link token was issued but the email carrying it could not
 * be delivered. Distinct from a generic email failure because the caller must
 * surface it: the link is the merchant's only way in, so a silent success would
 * leave them waiting on mail that will never arrive.
 */
public class MagicLinkDeliveryException extends RuntimeException {

    public MagicLinkDeliveryException(String message, Throwable cause) {
        super(message, cause);
    }
}
