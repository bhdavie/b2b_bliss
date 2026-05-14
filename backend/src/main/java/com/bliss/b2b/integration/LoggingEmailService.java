package com.bliss.b2b.integration;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Dev default. Prints messages to the application log so magic links and
 * notifications can be retrieved without a real email provider. Replaced by
 * PostmarkEmailService when BLISS_POSTMARK_TOKEN is set.
 */
public class LoggingEmailService implements EmailService {

    private static final Logger log = LoggerFactory.getLogger("bliss.email");

    @Override
    public void send(EmailMessage message) {
        log.info("[email→{}] subject={}\n{}",
                message.to(), message.subject(), message.body());
    }
}
