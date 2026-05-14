package com.bliss.b2b.integration;

import com.bliss.b2b.domain.Booking;
import com.bliss.b2b.domain.Customer;
import com.bliss.b2b.domain.Merchant;
import com.bliss.b2b.domain.PaymentPlan;
import com.bliss.b2b.domain.PaymentScheduleEntry;
import java.time.Duration;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Locale;

public final class EmailTemplates {

    private static final DateTimeFormatter LONG_DATE =
            DateTimeFormatter.ofPattern("EEEE, MMMM d, yyyy", Locale.US);
    private static final DateTimeFormatter SHORT_DATE =
            DateTimeFormatter.ofPattern("MMM d, yyyy", Locale.US);

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

    public static EmailMessage customerPlanConfirmation(
            String to,
            Merchant merchant,
            Booking booking,
            PaymentPlan plan,
            List<PaymentScheduleEntry> schedule
    ) {
        StringBuilder sb = new StringBuilder();
        sb.append("Your plan with ").append(merchant.businessName()).append(" is set.\n\n");
        sb.append("Booking: ").append(booking.serviceName()).append('\n');
        sb.append("Appointment: ").append(LONG_DATE.format(booking.appointmentDate())).append('\n');
        sb.append("Total: $").append(formatDollars(plan.totalAmountCents())).append('\n');
        sb.append("Plan: ").append(plan.numPayments()).append(' ')
                .append(plan.frequency().wire()).append(" payments\n\n");
        sb.append("Schedule:\n");
        for (PaymentScheduleEntry entry : schedule) {
            sb.append("  ").append(entry.sequence()).append(". ")
                    .append(SHORT_DATE.format(entry.dueDate()))
                    .append(" — $").append(formatDollars(entry.amountCents()))
                    .append('\n');
        }
        sb.append("\nYour first payment is processing. Subsequent payments will be charged");
        sb.append(" automatically to the card on file.\n\n");
        sb.append("Manage your plan anytime by visiting bliss.com/account.\n");
        return new EmailMessage(to, "Your plan with " + merchant.businessName() + " is set", sb.toString());
    }

    public static EmailMessage merchantBookingAccepted(
            Merchant merchant,
            Booking booking,
            Customer customer,
            PaymentPlan plan
    ) {
        String body = """
                A customer just accepted a booking.

                Booking: %s
                Appointment: %s
                Total: $%s
                Plan: %d %s payments
                Customer: %s

                You will receive a payout for the full amount minus the Bliss
                fee once the final payment clears.
                """.formatted(
                booking.serviceName(),
                LONG_DATE.format(booking.appointmentDate()),
                formatDollars(plan.totalAmountCents()),
                plan.numPayments(),
                plan.frequency().wire(),
                customer.email()
        );
        return new EmailMessage(merchant.email(),
                "New booking accepted: " + booking.serviceName(), body);
    }

    private static String formatDollars(long cents) {
        long whole = cents / 100;
        long fraction = Math.abs(cents % 100);
        return String.format(Locale.US, "%,d.%02d", whole, fraction);
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
