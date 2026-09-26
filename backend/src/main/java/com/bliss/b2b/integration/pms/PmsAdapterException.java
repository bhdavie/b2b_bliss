package com.bliss.b2b.integration.pms;

/**
 * Unchecked failure from a {@link PmsAdapter} call (missing credentials,
 * transport failure, non-2xx response, or an unparseable body).
 */
public class PmsAdapterException extends RuntimeException {

    /** The PMS's HTTP status for a non-2xx response; 0 when there was no response. */
    private final int httpStatus;
    /** The PMS's own error message from the response body, when it gave one. */
    private final String pmsMessage;

    public PmsAdapterException(String message) {
        this(message, 0, null);
    }

    public PmsAdapterException(String message, Throwable cause) {
        super(message, cause);
        this.httpStatus = 0;
        this.pmsMessage = null;
    }

    public PmsAdapterException(String message, int httpStatus, String pmsMessage) {
        super(message);
        this.httpStatus = httpStatus;
        this.pmsMessage = pmsMessage;
    }

    public int httpStatus() {
        return httpStatus;
    }

    public String pmsMessage() {
        return pmsMessage;
    }
}
