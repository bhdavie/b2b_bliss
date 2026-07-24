package com.bliss.b2b.integration.pms;

/**
 * Unchecked failure from a {@link PmsAdapter} call (missing credentials,
 * transport failure, non-2xx response, or an unparseable body). Mirrors the
 * shape of {@link com.bliss.b2b.integration.MewsApiException} so the two Mews
 * surfaces (reservation sync and the PMS rail) fail the same way.
 */
public class PmsAdapterException extends RuntimeException {

    public PmsAdapterException(String message) {
        super(message);
    }

    public PmsAdapterException(String message, Throwable cause) {
        super(message, cause);
    }
}
