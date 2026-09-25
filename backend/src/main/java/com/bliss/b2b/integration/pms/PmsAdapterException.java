package com.bliss.b2b.integration.pms;

/**
 * Unchecked failure from a {@link PmsAdapter} call (missing credentials,
 * transport failure, non-2xx response, or an unparseable body).
 */
public class PmsAdapterException extends RuntimeException {

    public PmsAdapterException(String message) {
        super(message);
    }

    public PmsAdapterException(String message, Throwable cause) {
        super(message, cause);
    }
}
