package com.bliss.b2b.api;

public record StripeStatusView(
        String status,
        String accountId,
        boolean chargesEnabled,
        boolean payoutsEnabled,
        boolean detailsSubmitted,
        String disabledReason,
        boolean configured
) {}
