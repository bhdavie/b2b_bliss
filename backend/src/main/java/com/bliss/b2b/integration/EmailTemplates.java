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

    /**
     * @param consumerBaseUrl base url of the consumer portal, which hosts the
     *                        manage-your-plan route this links to
     */
    public static EmailMessage customerPlanConfirmation(
            String to,
            Merchant merchant,
            Booking booking,
            PaymentPlan plan,
            List<PaymentScheduleEntry> schedule,
            String consumerBaseUrl
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
        sb.append("Manage your plan: ").append(consumerBaseUrl).append("/plan/")
                .append(booking.bookingToken())
                .append('\n');
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

    // ---- Guest transactional emails (plain, quiet, no marketing voice) -------
    // Sender name is "{property} via Bliss"; every one footers the same line.

    private static String dollars(long cents) {
        return "$" + formatDollars(cents);
    }

    static String senderName(Merchant merchant) {
        return propertyName(merchant) + " via Bliss";
    }

    private static String propertyName(Merchant merchant) {
        String name = merchant.businessName();
        return name == null || name.isBlank() ? "Your property" : name;
    }

    private static String portalUrl(String consumerBaseUrl, Booking booking) {
        return consumerBaseUrl + "/plan/" + booking.bookingToken();
    }

    private static String footerText(Merchant merchant, String portalUrl) {
        return "Scheduled by Bliss · charged by " + propertyName(merchant)
                + " · manage your plan: " + portalUrl;
    }

    private static String footerHtml(Merchant merchant, String portalUrl) {
        return "<p style=\"color:#6b6b6b;font-size:12px;margin-top:24px\">"
                + "Scheduled by Bliss · charged by " + esc(propertyName(merchant))
                + " · <a href=\"" + esc(portalUrl) + "\">manage your plan</a></p>";
    }

    private static String esc(String s) {
        return s == null ? "" : s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
    }

    private static EmailMessage guest(
            String to, String subject, Merchant merchant, String text, String htmlInner, String portalUrl) {
        String html = "<div style=\"font-family:sans-serif;color:#111;line-height:1.5\">"
                + htmlInner + footerHtml(merchant, portalUrl) + "</div>";
        return new EmailMessage(to, subject, text + "\n\n" + footerText(merchant, portalUrl),
                html, senderName(merchant));
    }

    /** 1. Plan confirmation, on plan activation (all rails). */
    public static EmailMessage planConfirmation(
            String to, Merchant merchant, Booking booking, PaymentPlan plan,
            List<PaymentScheduleEntry> schedule, String consumerBaseUrl) {
        String url = portalUrl(consumerBaseUrl, booking);
        StringBuilder text = new StringBuilder();
        text.append("Your payment plan with ").append(propertyName(merchant)).append(" is set up.\n\n");
        text.append("Booking: ").append(booking.serviceName()).append('\n');
        text.append("Check-in: ").append(SHORT_DATE.format(booking.appointmentDate())).append('\n');
        if (booking.checkoutDate() != null) {
            text.append("Check-out: ").append(SHORT_DATE.format(booking.checkoutDate())).append('\n');
        }
        text.append("Total: ").append(dollars(plan.totalAmountCents())).append('\n');
        text.append("Payments: ").append(plan.numPayments()).append(' ')
                .append(plan.frequency().wire()).append("\n\nSchedule:\n");
        StringBuilder rows = new StringBuilder();
        for (PaymentScheduleEntry e : schedule) {
            text.append("  ").append(SHORT_DATE.format(e.dueDate()))
                    .append("  ").append(dollars(e.amountCents())).append('\n');
            rows.append("<tr><td style=\"padding:2px 12px 2px 0\">")
                    .append(SHORT_DATE.format(e.dueDate())).append("</td><td style=\"padding:2px 0\">")
                    .append(dollars(e.amountCents())).append("</td></tr>");
        }
        String html = "<p>Your payment plan with " + esc(propertyName(merchant)) + " is set up.</p>"
                + "<p>" + esc(booking.serviceName()) + "<br>Check-in "
                + SHORT_DATE.format(booking.appointmentDate()) + "<br>Total " + dollars(plan.totalAmountCents())
                + " over " + plan.numPayments() + " " + plan.frequency().wire() + " payments.</p>"
                + "<table style=\"font-size:14px;border-collapse:collapse\">" + rows + "</table>";
        return guest(to, "Your payment plan with " + propertyName(merchant), merchant,
                text.toString().stripTrailing(), html, url);
    }

    /** 2. Payment receipt, when an installment transitions to PAID. */
    public static EmailMessage paymentReceipt(
            String to, Merchant merchant, Booking booking, long amountCents,
            long remainingCents, java.time.LocalDate nextDueDate, Long nextAmountCents,
            String consumerBaseUrl) {
        String url = portalUrl(consumerBaseUrl, booking);
        String line2 = remainingCents <= 0
                ? "This was your final payment. Nothing remains."
                : "Remaining balance: " + dollars(remainingCents)
                    + (nextDueDate != null
                        ? ". Next payment " + (nextAmountCents != null ? dollars(nextAmountCents) + " " : "")
                          + "on " + SHORT_DATE.format(nextDueDate) + "."
                        : ".");
        String text = "We charged " + dollars(amountCents) + " to your card for "
                + booking.serviceName() + ".\n" + line2;
        String html = "<p>We charged " + dollars(amountCents) + " to your card for "
                + esc(booking.serviceName()) + ".</p><p>" + esc(line2) + "</p>";
        return guest(to, "Receipt: " + dollars(amountCents) + " payment to " + propertyName(merchant),
                merchant, text, html, url);
    }

    /** 3. Plan complete, when the plan transitions to completed. */
    public static EmailMessage planComplete(
            String to, Merchant merchant, Booking booking, long totalPaidCents, String consumerBaseUrl) {
        String url = portalUrl(consumerBaseUrl, booking);
        String text = "Your payment plan with " + propertyName(merchant) + " is paid in full.\n\n"
                + "Booking: " + booking.serviceName() + "\n"
                + "Total paid: " + dollars(totalPaidCents);
        String html = "<p>Your payment plan with " + esc(propertyName(merchant)) + " is paid in full.</p>"
                + "<p>" + esc(booking.serviceName()) + "<br>Total paid " + dollars(totalPaidCents) + "</p>";
        return guest(to, "Your payment plan with " + propertyName(merchant) + " is complete",
                merchant, text, html, url);
    }

    /** 4. Payment failed, when an installment enters the failure/retry path. */
    public static EmailMessage paymentFailed(
            String to, Merchant merchant, Booking booking, long amountCents,
            int retryAttempts, int retrySpacingDays, String consumerBaseUrl) {
        String url = portalUrl(consumerBaseUrl, booking);
        String retryLine = retryAttempts <= 1
                ? "We will try once more."
                : "We will retry up to " + retryAttempts + " times, "
                    + retrySpacingDays + " " + (retrySpacingDays == 1 ? "day" : "days") + " apart.";
        String text = "A " + dollars(amountCents) + " payment to " + propertyName(merchant)
                + " for " + booking.serviceName() + " did not go through.\n\n"
                + retryLine + " To avoid missed payments, update your card in your plan:\n" + url;
        String html = "<p>A " + dollars(amountCents) + " payment to " + esc(propertyName(merchant))
                + " for " + esc(booking.serviceName()) + " did not go through.</p>"
                + "<p>" + esc(retryLine) + " To avoid missed payments, "
                + "<a href=\"" + esc(url) + "\">update your card</a>.</p>";
        return guest(to, "Action needed: payment to " + propertyName(merchant) + " did not go through",
                merchant, text, html, url);
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
