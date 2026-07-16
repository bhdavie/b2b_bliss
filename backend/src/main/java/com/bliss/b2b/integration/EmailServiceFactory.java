package com.bliss.b2b.integration;

import com.bliss.b2b.BlissConfiguration.EmailConfig;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public final class EmailServiceFactory {

    private static final Logger log = LoggerFactory.getLogger(EmailServiceFactory.class);

    private EmailServiceFactory() {}

    public static EmailService build(EmailConfig config) {
        if (config == null || config.getPostmarkToken() == null || config.getPostmarkToken().isBlank()) {
            log.info("Postmark token not configured; using logging email service");
            return new LoggingEmailService();
        }
        // No logging fallback behind Postmark: a send that fails has to throw so
        // the caller can react. Quietly logging the body instead would report
        // success for mail that was never delivered.
        log.info("Postmark token detected; using PostmarkEmailService (from={})", config.getFromAddress());
        return new PostmarkEmailService(config.getPostmarkToken(), config.getFromAddress());
    }
}
