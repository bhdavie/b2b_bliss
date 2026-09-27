package com.bliss.b2b.integration.pms;

/**
 * A {@link PmsAdapter} capability that a given PMS does not (yet) support through
 * this integration. Distinct from a transient {@link PmsAdapterException}: this
 * signals a deliberate, not-built-yet gap so callers can surface a clear message
 * rather than treat it as a retryable error.
 *
 * <p>Used for reservation-state reads on rails that have none, and by the Mews
 * customer lookup, which only searches: Bliss does not create Mews customers.
 */
public class PmsNotSupportedException extends PmsAdapterException {

    public PmsNotSupportedException(String message) {
        super(message);
    }
}
