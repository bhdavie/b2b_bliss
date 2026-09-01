package com.bliss.b2b.integration;

/**
 * @param to       recipient address
 * @param subject  subject line
 * @param body     plain-text body, always required
 * @param htmlBody optional HTML alternative; null when the template is text-only
 * @param fromName optional sender display name (e.g. "Marbrook House via Bliss");
 *                 null falls back to the bare configured from address
 */
public record EmailMessage(
        String to,
        String subject,
        String body,
        String htmlBody,
        String fromName
) {
    // NOTE on the two convenience constructors below: both leave fromName
    // null, and a null fromName makes PostmarkEmailService send the bare
    // configured From address with no display name. Postmark then fills the
    // display name from the sender signature on the account, which is a
    // person's name, not the product's. Any guest-facing template must pass a
    // fromName explicitly. The plan emails get "{property} via Bliss" from
    // EmailTemplates.guest(); anything outside that helper has to set its own.

    /** Text-only message with no custom sender name. */
    public EmailMessage(String to, String subject, String body) {
        this(to, subject, body, null, null);
    }

    /** Text + HTML message with no custom sender name. */
    public EmailMessage(String to, String subject, String body, String htmlBody) {
        this(to, subject, body, htmlBody, null);
    }

    public boolean hasHtmlBody() {
        return htmlBody != null && !htmlBody.isBlank();
    }

    public boolean hasFromName() {
        return fromName != null && !fromName.isBlank();
    }
}
