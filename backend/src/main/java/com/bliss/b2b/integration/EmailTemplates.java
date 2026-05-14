package com.bliss.b2b.integration;

import com.bliss.b2b.domain.Merchant;
import java.time.Duration;

public final class EmailTemplates {

    private EmailTemplates() {}

    public static EmailMessage magicLink(String to, String url, Duration linkTtl) {
        return new EmailMessage(
                to,
                "Sign in to Bliss",
                """
                Welcome to Bliss. Click the link below to finish signing in.
                This link expires in %s.

                %s
                """.formatted(formatTtl(linkTtl), url)
        );
    }

    private static String formatTtl(Duration ttl) {
        long hours = ttl.toHours();
        if (hours >= 24 && ttl.toMinutes() % 60 == 0) {
            long days = hours / 24;
            return days == 1 ? "1 day" : days + " days";
        }
        if (hours >= 1 && ttl.toMinutes() % 60 == 0) {
            return hours == 1 ? "1 hour" : hours + " hours";
        }
        long mins = ttl.toMinutes();
        return mins + " minutes";
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
