package com.bliss.b2b.integration.pms;

/**
 * A {@link PmsAdapter} capability that a given PMS does not (yet) support through
 * this integration. Distinct from a transient {@link PmsAdapterException}: this
 * signals a deliberate, not-built-yet gap so callers can surface a clear message
 * rather than treat it as a retryable error.
 *
 * <p>Used by {@link CloudbedsAdapter#createCardCollectionRequest}: Cloudbeds has
 * no server-issued hosted card-entry request equivalent to Mews Payments
 * Checkout (card tokenization happens through the Cloudbeds client SDK / vault),
 * so that seam is not built here.
 */
public class PmsNotSupportedException extends PmsAdapterException {

    public PmsNotSupportedException(String message) {
        super(message);
    }
}
