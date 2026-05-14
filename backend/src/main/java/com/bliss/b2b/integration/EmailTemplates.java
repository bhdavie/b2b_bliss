package com.bliss.b2b.integration;

import com.bliss.b2b.domain.Merchant;

public final class EmailTemplates {

    private EmailTemplates() {}

    public static EmailMessage magicLink(String to, String url) {
        return new EmailMessage(
                to,
                "Sign in to Bliss",
                """
                Welcome to Bliss. Click the link below to finish signing in.
                This link expires in 15 minutes.

                %s
                """.formatted(url)
        );
    }

    public static EmailMessage stripeOnboardingComplete(Merchant merchant) {
        String name = merchant.businessName() != null ? merchant.businessName() : "there";
        return new EmailMessage(
                merchant.email(),
                "You are set up to accept payouts on Bliss",
                """
                Hi %s,

                Your Stripe account is active. You can now create bookings and
                send payment plan links to your customers from your Bliss
                dashboard.

                Sign in to your dashboard to create your first booking.
                """.formatted(name)
        );
    }
}
