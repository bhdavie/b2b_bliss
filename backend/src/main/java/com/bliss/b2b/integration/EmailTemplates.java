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

    /**
     * Guest sign-in link. Same card, wordmark and footer treatment as the plan
     * emails, so a guest sees one consistent sender.
     *
     * <p>It cannot use {@link #shell} because that keys its footer off a
     * Merchant, and a sign-in is not about one property: there is no booking to
     * name and no "charged by" clause that would be true. The footer here is
     * the Bliss attribution and a link to the account instead.
     */
    public static EmailMessage guestMagicLink(
            String to, String url, Duration linkTtl, String portalBaseUrl) {
        String ttl = formatTtl(linkTtl);
        String accountUrl = portalBaseUrl + "/account";

        String rows = heading("Sign in to Bliss")
                + para("Use the button below to open your account and see your payment plans. "
                    + "This link expires in " + ttl + " and can only be used once.")
                + button(url, "Sign in to Bliss")
                + "<tr><td style=\"padding:22px 40px 0 40px;font-family:" + SANS + ";font-size:13px;"
                + "line-height:1.6;color:" + MUTED + ";\">"
                + "If the button does not work, paste this into your browser:<br>"
                + "<span style=\"color:" + MUTED + ";word-break:break-all;\">" + esc(url) + "</span>"
                + "</td></tr>"
                + para("If you did not ask to sign in you can ignore this email. "
                    + "Nothing will change on your account.");

        String html = "<!DOCTYPE html>"
            + "<html><head><meta charset=\"utf-8\">"
            + "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
            + "<meta name=\"color-scheme\" content=\"light dark\">"
            + "<meta name=\"supported-color-schemes\" content=\"light dark\">"
            + "</head>"
            + "<body style=\"margin:0;padding:0;background-color:" + SAND + ";\">"
            + "<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\""
            + " style=\"background-color:" + SAND + ";margin:0;padding:0;\">"
            + "<tr><td align=\"center\" style=\"padding:32px 12px;\">"
            + "<table role=\"presentation\" width=\"600\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\""
            + " style=\"width:100%;max-width:600px;background-color:" + WHITE + ";"
            + "border:1px solid " + HAIRLINE + ";border-radius:16px;\">"
            + "<tr><td style=\"padding:32px 40px 0 40px;font-family:Georgia,'Times New Roman',serif;"
            + "font-size:26px;font-weight:bold;color:" + VIOLET + ";line-height:1;\">Bliss</td></tr>"
            + rows
            + "<tr><td style=\"padding:0 40px 36px 40px;\"></td></tr>"
            + "</table>"
            + "<table role=\"presentation\" width=\"600\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\""
            + " style=\"width:100%;max-width:600px;\">"
            + "<tr><td style=\"padding:20px 40px 8px 40px;font-family:" + SANS + ";font-size:12px;"
            + "line-height:1.6;color:" + MUTED + ";\">"
            + "Sent by Bliss · <a href=\"" + esc(accountUrl) + "\" style=\"color:" + MUTED + ";\">"
            + "your plans</a></td></tr></table>"
            + "</td></tr></table></body></html>";

        String text = "Sign in to Bliss\n\n"
                + "Use the link below to open your account and see your payment plans.\n"
                + "This link expires in " + ttl + " and can only be used once.\n\n"
                + url + "\n\n"
                + "If you did not ask to sign in you can ignore this email. "
                + "Nothing will change on your account.\n\n"
                + "Sent by Bliss · your plans: " + accountUrl + "\n";

        // Explicit fromName. Without it this falls through to the 4-arg
        // EmailMessage constructor, which sets fromName null, and
        // PostmarkEmailService then sends the bare configured address with no
        // display name — at which point Postmark supplies the sender
        // signature's own name, which is a person. Every other guest template
        // passes "{property} via Bliss" through guest(); this one has no
        // property, so it says Bliss.
        return new EmailMessage(to, "Sign in to Bliss", text, html, "Bliss");
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

    // ---- Guest transactional emails ---------------------------------------
    //
    // Table-based, inline-styled HTML with a plain-text alternative on every
    // message. Constraints these are written against, all of them load-bearing
    // in real clients rather than stylistic:
    //
    //  * Tables for layout. Outlook renders through Word, which supports no
    //    flexbox and no grid, and strips <style> blocks and classes.
    //  * Every colour is declared explicitly on the element that shows it,
    //    background AND foreground together. Gmail and Outlook dark modes
    //    recolour anything left to inherit, and a cell with a set background
    //    but an unset colour is how you get black text on a black card.
    //  * No background images and no spacer images: padding and border-collapse
    //    do the spacing, so blocked images cost nothing but the missing
    //    picture. There are no images at all in these mails.
    //  * Georgia for the wordmark and a system sans stack for everything else.
    //    Web fonts do not load in most clients, and the app's DM Serif Display
    //    would silently fall back to a random serif; Georgia is present
    //    everywhere and is already the wordmark face in the product.
    //  * 600px card, centred, because that is the width every client can show
    //    without horizontal scroll on a phone.
    //
    // Sender name stays "{property} via Bliss" and every message keeps the
    // "Scheduled by Bliss · charged by {property}" line, now set as a real
    // footer under the card rather than a paragraph inside the body.

    private static final String VIOLET = "#8B5CF6";
    private static final String INK = "#17131C";
    private static final String MUTED = "#6E6878";
    private static final String SAND = "#F6F4F1";
    private static final String WHITE = "#FFFFFF";
    private static final String HAIRLINE = "#E9E5E1";
    private static final String SANS =
            "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

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

    private static String esc(String s) {
        return s == null ? "" : s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
    }

    /**
     * The full HTML document: sand page, centred 600px white card, Georgia
     * wordmark, then the caller's rows, then the footer under the card.
     *
     * <p>{@code innerRows} is a run of {@code <tr>} elements that drop straight
     * into the card's own table, so each template controls its own vertical
     * rhythm through cell padding rather than margins, which Outlook ignores.
     */
    private static String shell(Merchant merchant, String portalUrl, String innerRows) {
        return "<!DOCTYPE html>"
            + "<html><head><meta charset=\"utf-8\">"
            + "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
            // Tells iOS and Outlook the mail is designed for both schemes, which
            // stops the more aggressive automatic inversion.
            + "<meta name=\"color-scheme\" content=\"light dark\">"
            + "<meta name=\"supported-color-schemes\" content=\"light dark\">"
            + "</head>"
            + "<body style=\"margin:0;padding:0;background-color:" + SAND + ";\">"
            + "<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\""
            + " style=\"background-color:" + SAND + ";margin:0;padding:0;\">"
            + "<tr><td align=\"center\" style=\"padding:32px 12px;\">"
            // 600 fixed for Outlook, max-width for phones.
            + "<table role=\"presentation\" width=\"600\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\""
            + " style=\"width:100%;max-width:600px;background-color:" + WHITE + ";"
            + "border:1px solid " + HAIRLINE + ";border-radius:16px;\">"
            + "<tr><td style=\"padding:32px 40px 0 40px;font-family:Georgia,'Times New Roman',serif;"
            + "font-size:26px;font-weight:bold;color:" + VIOLET + ";line-height:1;\">Bliss</td></tr>"
            + innerRows
            + "<tr><td style=\"padding:0 40px 36px 40px;\"></td></tr>"
            + "</table>"
            + footerBlock(merchant, portalUrl)
            + "</td></tr></table></body></html>";
    }

    /** Footer under the card, on the sand ground. Muted, small, not a card row. */
    private static String footerBlock(Merchant merchant, String portalUrl) {
        return "<table role=\"presentation\" width=\"600\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\""
            + " style=\"width:100%;max-width:600px;\">"
            + "<tr><td style=\"padding:20px 40px 8px 40px;font-family:" + SANS + ";font-size:12px;"
            + "line-height:1.6;color:" + MUTED + ";\">"
            + "Scheduled by Bliss · charged by " + esc(propertyName(merchant))
            + " · <a href=\"" + esc(portalUrl) + "\" style=\"color:" + MUTED + ";\">manage your plan</a>"
            + "</td></tr></table>";
    }

    /** Card heading row. */
    private static String heading(String text) {
        return "<tr><td style=\"padding:22px 40px 0 40px;font-family:" + SANS + ";font-size:24px;"
            + "line-height:1.25;font-weight:600;color:" + INK + ";\">" + esc(text) + "</td></tr>";
    }

    /**
     * The one number or fact the mail exists to deliver, set large under the
     * heading. Sized down from the heading rather than up, so a long amount
     * cannot wrap awkwardly on a narrow phone.
     */
    private static String keyFact(String value, String caption) {
        return "<tr><td style=\"padding:18px 40px 0 40px;font-family:" + SANS + ";font-size:32px;"
            + "line-height:1.15;font-weight:600;color:" + INK + ";\">" + esc(value) + "</td></tr>"
            + (caption == null ? "" :
               "<tr><td style=\"padding:6px 40px 0 40px;font-family:" + SANS + ";font-size:14px;"
               + "line-height:1.5;color:" + MUTED + ";\">" + esc(caption) + "</td></tr>");
    }

    /** Body paragraph. */
    private static String para(String text) {
        return "<tr><td style=\"padding:16px 40px 0 40px;font-family:" + SANS + ";font-size:15px;"
            + "line-height:1.6;color:" + MUTED + ";\">" + esc(text) + "</td></tr>";
    }

    /** Label/value detail rows, hairline separated. */
    private static String detailTable(String[][] pairs) {
        StringBuilder rows = new StringBuilder();
        for (String[] pair : pairs) {
            if (pair[1] == null || pair[1].isBlank()) continue;
            rows.append("<tr>")
                .append("<td style=\"padding:10px 0;border-bottom:1px solid ").append(HAIRLINE)
                .append(";font-family:").append(SANS).append(";font-size:14px;color:").append(MUTED)
                .append(";\">").append(esc(pair[0])).append("</td>")
                .append("<td align=\"right\" style=\"padding:10px 0;border-bottom:1px solid ").append(HAIRLINE)
                .append(";font-family:").append(SANS).append(";font-size:14px;font-weight:600;color:")
                .append(INK).append(";\">").append(esc(pair[1])).append("</td>")
                .append("</tr>");
        }
        return "<tr><td style=\"padding:22px 40px 0 40px;\">"
            + "<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\">"
            + rows + "</table></td></tr>";
    }

    /**
     * Bulletproof button. A single-cell table with the background on the cell
     * and an anchor filling it, which is the shape that survives Outlook. The
     * anchor carries its own colour so a dark-mode recolour of the cell cannot
     * leave white-on-white.
     */
    private static String button(String url, String label) {
        return "<tr><td style=\"padding:26px 40px 0 40px;\">"
            + "<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\">"
            + "<tr><td align=\"center\" style=\"background-color:" + VIOLET + ";border-radius:999px;\">"
            + "<a href=\"" + esc(url) + "\" style=\"display:inline-block;padding:14px 32px;"
            + "font-family:" + SANS + ";font-size:15px;font-weight:600;color:" + WHITE + ";"
            + "text-decoration:none;border-radius:999px;\">" + esc(label) + "</a>"
            + "</td></tr></table></td></tr>";
    }

    /**
     * The installment schedule as a real table: sequence, date, amount, and a
     * status word. The next unpaid row is marked in violet and bolded, so the
     * guest can see at a glance what is coming rather than counting rows.
     */
    private static String scheduleTable(List<PaymentScheduleEntry> schedule) {
        int nextSeq = nextDueSequence(schedule);
        StringBuilder rows = new StringBuilder();
        rows.append("<tr>")
            .append(th("Payment")).append(th("Date")).append(thRight("Amount"))
            .append("</tr>");
        for (PaymentScheduleEntry e : schedule) {
            boolean isNext = e.sequence() == nextSeq;
            boolean paid = e.status() == com.bliss.b2b.domain.PaymentScheduleStatus.PAID;
            String colour = isNext ? VIOLET : (paid ? MUTED : INK);
            String weight = isNext ? "600" : "400";
            String label = e.sequence() + " of " + schedule.size()
                    + (isNext ? " · Next" : paid ? " · Paid" : "");
            rows.append("<tr>")
                .append("<td style=\"padding:11px 0;border-bottom:1px solid ").append(HAIRLINE)
                .append(";font-family:").append(SANS).append(";font-size:14px;font-weight:").append(weight)
                .append(";color:").append(colour).append(";\">").append(esc(label)).append("</td>")
                .append("<td style=\"padding:11px 0;border-bottom:1px solid ").append(HAIRLINE)
                .append(";font-family:").append(SANS).append(";font-size:14px;color:").append(colour)
                .append(";\">").append(SHORT_DATE.format(e.dueDate())).append("</td>")
                .append("<td align=\"right\" style=\"padding:11px 0;border-bottom:1px solid ").append(HAIRLINE)
                .append(";font-family:").append(SANS).append(";font-size:14px;font-weight:600;color:")
                .append(colour).append(";\">").append(dollars(e.amountCents())).append("</td>")
                .append("</tr>");
        }
        return "<tr><td style=\"padding:24px 40px 0 40px;\">"
            + "<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\">"
            + rows + "</table></td></tr>";
    }

    private static String th(String label) {
        return "<td style=\"padding:0 0 8px 0;font-family:" + SANS + ";font-size:11px;"
            + "letter-spacing:0.08em;text-transform:uppercase;color:" + MUTED + ";\">"
            + esc(label) + "</td>";
    }

    private static String thRight(String label) {
        return "<td align=\"right\" style=\"padding:0 0 8px 0;font-family:" + SANS + ";font-size:11px;"
            + "letter-spacing:0.08em;text-transform:uppercase;color:" + MUTED + ";\">"
            + esc(label) + "</td>";
    }

    /** First not-yet-paid installment, or -1 when everything is settled. */
    private static int nextDueSequence(List<PaymentScheduleEntry> schedule) {
        for (PaymentScheduleEntry e : schedule) {
            if (e.status() != com.bliss.b2b.domain.PaymentScheduleStatus.PAID
                    && e.status() != com.bliss.b2b.domain.PaymentScheduleStatus.CANCELED) {
                return e.sequence();
            }
        }
        return -1;
    }

    /** Plain-text schedule, column-aligned so it reads in a monospace client. */
    private static String scheduleTextRows(List<PaymentScheduleEntry> schedule) {
        int nextSeq = nextDueSequence(schedule);
        StringBuilder sb = new StringBuilder();
        for (PaymentScheduleEntry e : schedule) {
            String marker = e.sequence() == nextSeq ? "->" : "  ";
            sb.append(String.format(Locale.US, "%s %-2d of %-2d  %-13s %10s%s%n",
                    marker, e.sequence(), schedule.size(),
                    SHORT_DATE.format(e.dueDate()), dollars(e.amountCents()),
                    e.status() == com.bliss.b2b.domain.PaymentScheduleStatus.PAID ? "  paid" : ""));
        }
        return sb.toString();
    }

    /**
     * Assembles a guest message. Both parts are always produced: the plain-text
     * alternative is not a fallback nobody reads, it is what text-only clients,
     * watch previews and spam scoring actually see.
     */
    private static EmailMessage guest(
            String to, String subject, Merchant merchant, String text, String innerRows, String portalUrl) {
        return new EmailMessage(
                to,
                subject,
                text.stripTrailing() + "\n\n" + footerText(merchant, portalUrl) + "\n",
                shell(merchant, portalUrl, innerRows),
                senderName(merchant));
    }

    /** 1. Plan confirmation, on plan activation (all rails). */
    public static EmailMessage planConfirmation(
            String to, Merchant merchant, Booking booking, PaymentPlan plan,
            List<PaymentScheduleEntry> schedule, String consumerBaseUrl) {
        String url = portalUrl(consumerBaseUrl, booking);
        String property = propertyName(merchant);
        String stay = booking.checkoutDate() != null
                ? SHORT_DATE.format(booking.appointmentDate()) + " to "
                    + SHORT_DATE.format(booking.checkoutDate())
                : SHORT_DATE.format(booking.appointmentDate());

        String rows = heading("Your payment plan is set")
                + keyFact(dollars(plan.totalAmountCents()),
                    plan.numPayments() + " " + plan.frequency().wire() + " payments to " + property)
                + detailTable(new String[][] {
                    {"Booking", booking.serviceName()},
                    {"Stay", stay},
                })
                + scheduleTable(schedule)
                + para("Each payment is charged automatically to the card you saved. "
                    + "We will email you a receipt every time.")
                + button(url, "View your plan");

        StringBuilder text = new StringBuilder();
        text.append("Your payment plan is set.\n\n")
            .append(dollars(plan.totalAmountCents())).append(" to ").append(property)
            .append(" over ").append(plan.numPayments()).append(' ')
            .append(plan.frequency().wire()).append(" payments.\n\n")
            .append("Booking: ").append(booking.serviceName()).append('\n')
            .append("Stay:    ").append(stay).append("\n\n")
            .append("Schedule\n")
            .append(scheduleTextRows(schedule))
            .append("\nEach payment is charged automatically to the card you saved. ")
            .append("We will email you a receipt every time.\n\n")
            .append("View your plan: ").append(url).append('\n');

        return guest(to, "Your payment plan with " + property, merchant, text.toString(), rows, url);
    }

    /** 2. Payment receipt, when an installment transitions to PAID. */
    public static EmailMessage paymentReceipt(
            String to, Merchant merchant, Booking booking, long amountCents,
            long remainingCents, java.time.LocalDate nextDueDate, Long nextAmountCents,
            String consumerBaseUrl) {
        String url = portalUrl(consumerBaseUrl, booking);
        String property = propertyName(merchant);
        boolean settled = remainingCents <= 0;
        String nextLine = settled
                ? "This was your final payment. Nothing remains."
                : nextDueDate != null
                    ? "Next payment "
                        + (nextAmountCents != null ? dollars(nextAmountCents) + " " : "")
                        + "on " + SHORT_DATE.format(nextDueDate) + "."
                    : "";

        String rows = heading("Payment received")
                + keyFact(dollars(amountCents), "charged to your card by " + property)
                + detailTable(new String[][] {
                    {"Booking", booking.serviceName()},
                    {"Remaining balance", settled ? "$0.00" : dollars(remainingCents)},
                    {"Next payment", settled ? "None" :
                        (nextDueDate != null ? SHORT_DATE.format(nextDueDate) : "")},
                })
                + (nextLine.isBlank() ? "" : para(nextLine))
                + button(url, "View your plan");

        String text = "Payment received.\n\n"
                + dollars(amountCents) + " charged to your card by " + property + ".\n\n"
                + "Booking:           " + booking.serviceName() + "\n"
                + "Remaining balance: " + (settled ? "$0.00" : dollars(remainingCents)) + "\n"
                + (settled ? "" : nextDueDate != null
                    ? "Next payment:      " + SHORT_DATE.format(nextDueDate) + "\n" : "")
                + "\n" + nextLine + "\n\n"
                + "View your plan: " + url + "\n";

        return guest(to, "Receipt: " + dollars(amountCents) + " payment to " + property,
                merchant, text, rows, url);
    }

    /** 3. Plan complete, when the plan transitions to completed. */
    public static EmailMessage planComplete(
            String to, Merchant merchant, Booking booking, long totalPaidCents, String consumerBaseUrl) {
        String url = portalUrl(consumerBaseUrl, booking);
        String property = propertyName(merchant);

        String rows = heading("You are all paid up")
                + keyFact(dollars(totalPaidCents), "paid in full to " + property)
                + detailTable(new String[][] {
                    {"Booking", booking.serviceName()},
                    {"Status", "Paid in full"},
                })
                + para("Nothing further is owed and no more payments will be taken. "
                    + "Your booking is confirmed with " + property + ".")
                + button(url, "View your plan");

        String text = "You are all paid up.\n\n"
                + dollars(totalPaidCents) + " paid in full to " + property + ".\n\n"
                + "Booking: " + booking.serviceName() + "\n"
                + "Status:  Paid in full\n\n"
                + "Nothing further is owed and no more payments will be taken. "
                + "Your booking is confirmed with " + property + ".\n\n"
                + "View your plan: " + url + "\n";

        return guest(to, "Your payment plan with " + property + " is complete",
                merchant, text, rows, url);
    }

    /** 4. Payment failed, when an installment enters the failure/retry path. */
    public static EmailMessage paymentFailed(
            String to, Merchant merchant, Booking booking, long amountCents,
            int retryAttempts, int retrySpacingDays, String consumerBaseUrl) {
        String url = portalUrl(consumerBaseUrl, booking);
        String property = propertyName(merchant);
        String retryLine = retryAttempts <= 1
                ? "We will try once more."
                : "We will retry up to " + retryAttempts + " times, "
                    + retrySpacingDays + " " + (retrySpacingDays == 1 ? "day" : "days") + " apart.";

        // No red. A declined card is routine and recoverable, and a red banner
        // is also the first thing a dark-mode recolour makes unreadable. The
        // urgency is carried by the heading and the button label instead.
        String rows = heading("We could not take your payment")
                + keyFact(dollars(amountCents), "declined by your card for " + property)
                + detailTable(new String[][] {
                    {"Booking", booking.serviceName()},
                    {"Amount due", dollars(amountCents)},
                })
                + para(retryLine + " Updating your card now is the quickest way to keep the plan on track.")
                + button(url, "Update your card");

        String text = "We could not take your payment.\n\n"
                + dollars(amountCents) + " was declined by your card for " + property + ".\n\n"
                + "Booking:    " + booking.serviceName() + "\n"
                + "Amount due: " + dollars(amountCents) + "\n\n"
                + retryLine + " Updating your card now is the quickest way to keep the plan on track.\n\n"
                + "Update your card: " + url + "\n";

        return guest(to, "Action needed: payment to " + property + " did not go through",
                merchant, text, rows, url);
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
                "Your Stripe account is connected",
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
