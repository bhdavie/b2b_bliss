package com.bliss.b2b.integration;

public record EmailMessage(
        String to,
        String subject,
        String body
) {}
