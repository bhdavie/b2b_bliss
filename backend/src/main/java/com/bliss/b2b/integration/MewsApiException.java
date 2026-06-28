package com.bliss.b2b.integration;

/** Raised when a Mews Connector API call cannot be completed or parsed. */
public class MewsApiException extends RuntimeException {

    public MewsApiException(String message) {
        super(message);
    }

    public MewsApiException(String message, Throwable cause) {
        super(message, cause);
    }
}
