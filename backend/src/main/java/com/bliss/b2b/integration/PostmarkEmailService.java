package com.bliss.b2b.integration;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Postmark integration placeholder. Activated when BLISS_POSTMARK_TOKEN is
 * configured. Real implementation goes here when the postmark-java client is
 * added as a dependency. For now this falls back to logging so the magic-link
 * flow stays exercisable without breaking when a token is set.
 */
public class PostmarkEmailService implements EmailService {

    private static final Logger log = LoggerFactory.getLogger(PostmarkEmailService.class);

    private final String serverToken;
    private final String fromAddress;
    private final EmailService fallback;

    public PostmarkEmailService(String serverToken, String fromAddress, EmailService fallback) {
        this.serverToken = serverToken;
        this.fromAddress = fromAddress;
        this.fallback = fallback;
    }

    @Override
    public void send(EmailMessage message) {
        log.warn("Postmark client not yet wired; falling back to log. from={} to={} tokenLen={}",
                fromAddress, message.to(), serverToken == null ? 0 : serverToken.length());
        fallback.send(message);
    }
}
