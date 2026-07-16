package com.bliss.b2b.integration;

/**
 * @param body     plain-text body, always required
 * @param htmlBody optional HTML alternative; null when the template is text-only
 */
public record EmailMessage(
        String to,
        String subject,
        String body,
        String htmlBody
) {
    /** Text-only message. Every current template uses this form. */
    public EmailMessage(String to, String subject, String body) {
        this(to, subject, body, null);
    }

    public boolean hasHtmlBody() {
        return htmlBody != null && !htmlBody.isBlank();
    }
}
