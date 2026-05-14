package com.bliss.b2b.integration;

import com.bliss.b2b.BlissConfiguration.EmailConfig;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public final class EmailServiceFactory {

    private static final Logger log = LoggerFactory.getLogger(EmailServiceFactory.class);

    private EmailServiceFactory() {}

    public static EmailService build(EmailConfig config) {
        EmailService logging = new LoggingEmailService();
        if (config == null || config.getPostmarkToken() == null || config.getPostmarkToken().isBlank()) {
            log.info("Postmark token not configured; using logging email service");
            return logging;
        }
        log.info("Postmark token detected; using PostmarkEmailService (from={})", config.getFromAddress());
        return new PostmarkEmailService(config.getPostmarkToken(), config.getFromAddress(), logging);
    }
}
