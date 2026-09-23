package com.bliss.b2b.integration;

import com.bliss.b2b.domain.Booking;
import com.bliss.b2b.domain.Customer;
import com.bliss.b2b.domain.Merchant;
import com.bliss.b2b.domain.PaymentPlan;
import com.bliss.b2b.domain.PaymentScheduleEntry;
import com.bliss.b2b.domain.PaymentScheduleStatus;
import com.bliss.b2b.domain.ReferralMessages;
import com.bliss.b2b.domain.ScheduleKind;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Locale;

public final class EmailTemplates {

    private static final DateTimeFormatter LONG_DATE =
            DateTimeFormatter.ofPattern("EEEE, MMMM d, yyyy", Locale.US);
    private static final DateTimeFormatter SHORT_DATE =
            DateTimeFormatter.ofPattern("MMM d, yyyy", Locale.US);
    /** "August 2, 2026" — the timeline's own date format on the plan page. */
    private static final DateTimeFormatter TIMELINE_DATE =
            DateTimeFormatter.ofPattern("MMMM d, yyyy", Locale.US);

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
    /**
     * The referral emails' ground, and deliberately NOT {@link #SAND}. The site's
     * guest page sets its FAQ band on this exact value and the referral mail is
     * the other half of that flow, so the two are the same grey rather than two
     * neighbouring ones. The plan and sign-in mails keep the cream: they belong
     * to the merchant side, which the site never repainted.
     */
    private static final String REFERRAL_GROUND = "#E4E6EA";
    /**
     * The edge for anything filled with {@link #REFERRAL_GROUND}. {@link #HAIRLINE}
     * is LIGHTER than that grey (233,229,225 against 228,230,234), so it drew a
     * pale halo around the DM box rather than an edge. One neutral darker, which
     * is the same step the site takes for its own controls on this ground.
     */
    private static final String REFERRAL_EDGE = "#C9CCD1";
    private static final String WHITE = "#FFFFFF";
    private static final String HAIRLINE = "#E9E5E1";
    private static final String INK_400 = "#898294";
    private static final String LAVENDER = "#D6C8FB";
    private static final String SAND_300 = "#E9E5E1";
    private static final String SAND_400 = "#E2DEE6";
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
     * The installment schedule as the plan page's timeline, rebuilt in table
     * cells. Mirrors ScheduleTimeline in PlanPortal.tsx as closely as email
     * allows, and reproduces its logic rather than approximating it:
     *
     * <ul>
     *   <li>labelSchedule: a deposit row is labelled "Deposit"; installments are
     *       numbered 1..N of N over the NON-deposit rows only, so a plan with a
     *       deposit does not number it as installment 1.
     *   <li>rowDisplayStatus: paid, canceled, everything else scheduled.
     *   <li>The next row is the FIRST scheduled row, not a date comparison, so a
     *       failed row still awaiting retry can be next and a future row already
     *       paid is not.
     *   <li>Two lines per row: label with amount opposite, then the dated status
     *       line. The next payment says "Automatic on {date} · Next payment ·
     *       Scheduled"; others say "Due {date} · {status}".
     *   <li>A canceled row drops label and amount to the muted tone, so it reads
     *       as struck from the plan rather than merely pending.
     * </ul>
     *
     * <p>Two departures forced by email. The rail is a fixed-height 2px cell
     * hanging below each node instead of a flex segment that fills its row, so
     * it approximates the row height rather than tracking it. And the nodes are
     * border-radius circles, which Outlook's Word renderer squares off: the
     * paid/next/upcoming distinction survives because it is carried by colour
     * and the ring's border, not by the shape.
     */
    private static String scheduleTimeline(List<PaymentScheduleEntry> schedule) {
        int installmentCount = 0;
        for (PaymentScheduleEntry e : schedule) {
            if (e.kind() != ScheduleKind.DEPOSIT) installmentCount++;
        }
        int nextIndex = nextScheduledIndex(schedule);

        StringBuilder rows = new StringBuilder();
        int installmentNumber = 0;
        for (int i = 0; i < schedule.size(); i++) {
            PaymentScheduleEntry e = schedule.get(i);
            String label;
            if (e.kind() == ScheduleKind.DEPOSIT) {
                label = "Deposit";
            } else {
                installmentNumber++;
                label = "Installment " + installmentNumber + " of " + installmentCount;
            }

            String base = rowDisplayStatus(e.status());
            String state = "scheduled".equals(base) && i == nextIndex ? "next" : base;
            boolean isLast = i == schedule.size() - 1;

            String statusWord = switch (state) {
                case "paid" -> "Paid";
                case "canceled" -> "Canceled";
                default -> "Scheduled";
            };
            String meta = "next".equals(state)
                    ? "Automatic on " + TIMELINE_DATE.format(e.dueDate())
                        + " · Next payment · " + statusWord
                    : "Due " + TIMELINE_DATE.format(e.dueDate()) + " · " + statusWord;

            String labelColour = "canceled".equals(state) ? INK_400 : INK;
            String amountColour = "canceled".equals(state) ? INK_400 : MUTED;

            rows.append("<tr>")
                // Rail column: node, then the connector hanging below it.
                .append("<td valign=\"top\" width=\"26\" style=\"width:26px;padding:0;\">")
                .append("<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\">")
                .append("<tr><td style=\"padding:6px 0 0 0;line-height:0;\">")
                .append(node(state))
                .append("</td></tr>")
                .append(isLast ? "" :
                    "<tr><td align=\"center\" style=\"padding:0;\">"
                    + "<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\">"
                    + "<tr><td width=\"2\" height=\"30\" style=\"width:2px;height:30px;font-size:0;"
                    + "line-height:0;background-color:"
                    + ("paid".equals(state) ? LAVENDER : SAND_300) + ";\">&nbsp;</td></tr>"
                    + "</table></td></tr>")
                .append("</table></td>")
                // Content column: line one label + amount, line two the meta.
                .append("<td valign=\"top\" style=\"padding:0 0 ")
                .append(isLast ? "0" : "14px").append(" 26px;\">")
                .append("<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\">")
                .append("<tr>")
                .append("<td style=\"font-family:").append(SANS)
                .append(";font-size:16px;font-weight:600;color:").append(labelColour).append(";\">")
                .append(esc(label)).append("</td>")
                .append("<td align=\"right\" style=\"font-family:").append(SANS)
                .append(";font-size:16px;color:").append(amountColour).append(";\">")
                .append(dollars(e.amountCents())).append("</td>")
                .append("</tr>")
                .append("<tr><td colspan=\"2\" style=\"padding-top:3px;font-family:").append(SANS)
                .append(";font-size:13px;line-height:1.5;color:").append(INK_400).append(";\">")
                .append(esc(meta)).append("</td></tr>")
                .append("</table></td></tr>");
        }

        return "<tr><td style=\"padding:24px 40px 0 40px;\">"
            + "<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\">"
            + rows + "</table></td></tr>";
    }

    /**
     * A 12px timeline node. Paid is a solid violet dot, next is a white dot with
     * a thick violet ring, upcoming and canceled are a solid warm grey. Matches
     * TimelineNode in PlanPortal.tsx.
     */
    private static String node(String state) {
        if ("next".equals(state)) {
            return "<div style=\"width:5px;height:5px;border-radius:50%;background-color:" + WHITE
                + ";border:3.5px solid " + VIOLET + ";font-size:0;line-height:0;\"></div>";
        }
        String fill = "paid".equals(state) ? VIOLET : SAND_400;
        return "<div style=\"width:12px;height:12px;border-radius:50%;background-color:" + fill
            + ";font-size:0;line-height:0;\"></div>";
    }

    /** Mirrors rowDisplayStatus in PlanPortal.tsx. */
    private static String rowDisplayStatus(PaymentScheduleStatus status) {
        if (status == PaymentScheduleStatus.PAID) return "paid";
        if (status == PaymentScheduleStatus.CANCELED) return "canceled";
        return "scheduled";
    }

    /** Index of the first row that displays as scheduled, or -1 when none do. */
    private static int nextScheduledIndex(List<PaymentScheduleEntry> schedule) {
        for (int i = 0; i < schedule.size(); i++) {
            if ("scheduled".equals(rowDisplayStatus(schedule.get(i).status()))) return i;
        }
        return -1;
    }

    /**
     * Plain-text timeline. Carries the same labels, states and next-payment
     * marker as the HTML, column aligned so it holds shape in a monospace
     * client.
     */
    private static String scheduleTextRows(List<PaymentScheduleEntry> schedule) {
        int installmentCount = 0;
        for (PaymentScheduleEntry e : schedule) {
            if (e.kind() != ScheduleKind.DEPOSIT) installmentCount++;
        }
        int nextIndex = nextScheduledIndex(schedule);
        StringBuilder sb = new StringBuilder();
        int installmentNumber = 0;
        for (int i = 0; i < schedule.size(); i++) {
            PaymentScheduleEntry e = schedule.get(i);
            String label;
            if (e.kind() == ScheduleKind.DEPOSIT) {
                label = "Deposit";
            } else {
                installmentNumber++;
                label = "Installment " + installmentNumber + " of " + installmentCount;
            }
            String base = rowDisplayStatus(e.status());
            String state = "scheduled".equals(base) && i == nextIndex ? "next" : base;
            String statusWord = switch (state) {
                case "paid" -> "Paid";
                case "canceled" -> "Canceled";
                default -> "Scheduled";
            };
            String marker = "next".equals(state) ? "->" : "  ";
            sb.append(String.format(Locale.US, "%s %-22s %10s   %s%s%n",
                    marker, label, dollars(e.amountCents()),
                    TIMELINE_DATE.format(e.dueDate()),
                    "next".equals(state) ? " · Next payment · " + statusWord : " · " + statusWord));
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

        // What the guest actually pays: the plan total PLUS the processing fee.
        // The headline used plan.totalAmountCents() alone, which is the
        // post-discount booking price with no fee, so it read $994.15 while the
        // schedule underneath it summed to $1,043.86. This is the same figure
        // PlanPortal calls totalDue (plan.totalAmountCents + processingFeeCents)
        // and the same one PlanProgress takes as totalWithFeeCents, so the
        // email, the portal and the schedule now all state one number.
        long totalWithFee = plan.totalAmountCents() + plan.processingFeeCents();

        String rows = heading("Your payment plan is set")
                + keyFact(dollars(totalWithFee),
                    plan.numPayments() + " " + plan.frequency().wire() + " payments to " + property)
                + detailTable(new String[][] {
                    {"Booking", booking.serviceName()},
                    {"Stay", stay},
                })
                + scheduleTimeline(schedule)
                + para("Each payment is charged automatically to the card you saved. "
                    + "We will email you a receipt every time.")
                + button(url, "View your plan");

        StringBuilder text = new StringBuilder();
        text.append("Your payment plan is set.\n\n")
            .append(dollars(totalWithFee)).append(" to ").append(property)
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

    // --------------------------------------------------------- guest referrals

    /**
     * The four guest-facing referral emails. All plain Bliss sender, no
     * property: a referral is between the guest and us until the hotel is
     * live, so "{property} via Bliss" would name a merchant that may not exist.
     *
     * <p>Copy discipline for every string below is {@link ReferralMessages}'s:
     * no em dashes, no colons as connectors, no figure other than the $1,000
     * the guest is owed. These go to the guest, so the $1,000 belongs here in a
     * way it never does in the messages the hotel receives.
     */

    /**
     * Sent by POST /public/referrals/start. The guest's link, the three ways to
     * use it, and the page that tracks where each one got to.
     *
     * <p>This is now the ONLY place those three are delivered. The site used to
     * render them behind copy buttons and shows a confirmation instead, so a
     * guest who never gets the mail has nothing, which is why a failed send now
     * fails the request rather than being swallowed. See sendKitEmail.
     *
     * @param marketingBaseUrl BLISS_MARKETING_BASE_URL. Mail clients do not
     *     resolve relative image paths, so the photograph needs an absolute URL,
     *     and hard-coding a host would send localhost images from production.
     */
    public static EmailMessage referralLink(
            String to, String code, String link, String statusUrl, String marketingBaseUrl) {
        ReferralMessages.Kit kit = ReferralMessages.forLink(link);
        String site = stripTrailingSlash(marketingBaseUrl);
        String mailtoUrl = mailto(kit.email().subject(), kit.email().body());
        // One line, and the only line, of the front desk message. The rest of
        // that Message is the raw link, which this mail already shows below.
        //
        // The lead-in is added HERE rather than in ReferralMessages, because the
        // status page renders that same message under the heading "At the front
        // desk" and would then say it twice. This mail has no heading over the
        // line, so it carries its own.
        String deskLine = "At the front desk? " + firstLine(kit.desk().body());

        String rows =
                // The photograph, full bleed across the card with nothing beside
                // it. width and height are real attributes as well as styles
                // because Outlook reads the attributes and ignores the CSS;
                // display:block kills the baseline gap clients leave under an
                // inline image. With images blocked this collapses to the alt
                // text on one line and every row below it still reads in order.
                "<tr><td style=\"padding:24px 0 0 0;\">"
                + "<img src=\"" + esc(site + "/email/referral-bed.jpg") + "\" width=\"600\" height=\"200\""
                + " alt=\"A breakfast tray with two cups, a key card and a purple ribbon on a white bed\""
                + " style=\"display:block;width:100%;max-width:600px;height:auto;border:0;"
                + "outline:none;text-decoration:none;\"></td></tr>"

                + heading("Your link is ready")
                + para("Send it to any hotel you'd love to book with. When they start "
                    + "taking Bliss, we cover up to $1,000 of your next stay there.")

                + button(mailtoUrl, "Email a hotel")
                + small("Opens your email app with the message ready. Just add the "
                    + "hotel's address.")

                + subheading("Prefer Instagram? Paste this into a DM.")
                + quoteBox(kit.instagram().body())

                + para(deskLine)

                + linkLine(link)
                + small("Your code is " + code + ".")

                + button(statusUrl, "See your referrals")
                + small("Track every hotel you send it to.");

        String text = "Your link is ready\n\n"
                + "Send it to any hotel you'd love to book with. When they start taking "
                + "Bliss, we cover up to $1,000 of your next stay there.\n\n"
                + "EMAIL A HOTEL\n"
                + "Subject: " + kit.email().subject() + "\n\n"
                + kit.email().body() + "\n\n"
                + "PREFER INSTAGRAM? PASTE THIS INTO A DM.\n\n"
                + kit.instagram().body() + "\n\n"
                + deskLine + "\n\n"
                + "Your link\n"
                + link + "\n"
                + "Your code is " + code + ".\n\n"
                + "SEE YOUR REFERRALS\n"
                + "Track every hotel you send it to.\n"
                + statusUrl + "\n\n"
                + "You're getting this because you asked for a referral link at "
                + "bliss-payments.com. Questions? Email info@bliss-payments.com.\n"
                + "Terms " + site + REFERRAL_TERMS_PATH + "\n";

        return new EmailMessage(
                to, "Your Bliss referral link", text, referralShell(rows, site), "Bliss");
    }

    /**
     * The line an inbox list shows beside the subject. Hidden inside the body by
     * the trio that works across clients together and not separately: zero font
     * size and line height, zero opacity, and the max-height/overflow pair Gmail
     * needs. The run of zero-width non-joiners after it stops a client dragging
     * the next real sentence in behind the preheader to fill the space.
     */
    private static final String PREHEADER_TEXT = "Send it to a hotel you'd like to book with.";

    /**
     * The referral program's own part of the terms, not the terms as a whole.
     * This mail is about that program, so its footer points at the section
     * rather than the top of a page whose first fifteen clauses govern the
     * payment service instead.
     *
     * <p>The fragment is the id on that section's heading in the site's
     * app/terms/page.tsx, where it is also defined as REFERRAL_TERMS in
     * lib/routes.ts. Nothing can import across the two repositories, so this is
     * the second copy of that path and the one that has to move with it.
     */
    private static final String REFERRAL_TERMS_PATH = "/terms#referral-program";

    private static String preheader(String text) {
        return "<div style=\"display:none;font-size:1px;line-height:1px;max-height:0;"
            + "max-width:0;opacity:0;overflow:hidden;mso-hide:all;\">" + esc(text)
            + "&#8203;&zwnj;&zwnj;&zwnj;&zwnj;&zwnj;&zwnj;&zwnj;&zwnj;&zwnj;&zwnj;"
            + "&zwnj;&zwnj;&zwnj;&zwnj;&zwnj;&zwnj;&zwnj;&zwnj;&zwnj;&zwnj;</div>";
    }

    /**
     * A mailto with no recipient, so the guest picks the hotel in their own client.
     *
     * <p>URLEncoder, then "+" patched back to %20. URLEncoder writes form
     * encoding, where a space is a plus; that is right in a query string and
     * wrong in a mailto, where clients paste the plus into the body literally.
     * Newlines come through as %0A either way, which is what preserves the
     * paragraph breaks the copy was written with.
     */
    private static String mailto(String subject, String body) {
        return "mailto:?subject=" + encodeMailto(subject) + "&body=" + encodeMailto(body);
    }

    private static String encodeMailto(String raw) {
        return URLEncoder.encode(raw, StandardCharsets.UTF_8).replace("+", "%20");
    }

    private static String firstLine(String body) {
        int nl = body.indexOf('\n');
        return nl < 0 ? body : body.substring(0, nl);
    }

    private static String stripTrailingSlash(String url) {
        if (url == null || url.isBlank()) return "";
        return url.endsWith("/") ? url.substring(0, url.length() - 1) : url;
    }

    /** Section label. Steps down from {@link #heading}, so the mail has one top line and a rank below it. */
    private static String subheading(String text) {
        return "<tr><td style=\"padding:30px 40px 0 40px;font-family:" + SANS + ";font-size:17px;"
            + "line-height:1.4;font-weight:600;color:" + INK + ";\">" + esc(text) + "</td></tr>";
    }

    /** The one light box left in this mail, holding the DM to paste. */
    private static String quoteBox(String body) {
        return "<tr><td style=\"padding:12px 40px 0 40px;\">"
            + "<div style=\"font-family:" + SANS + ";font-size:15px;line-height:1.65;color:" + INK
            + ";background-color:" + REFERRAL_GROUND + ";border:1px solid " + REFERRAL_EDGE
            + ";border-radius:12px;"
            + "padding:16px 18px;\">" + esc(body) + "</div></td></tr>";
    }

    /** The raw link, wrapping rather than running off the side of a phone. */
    private static String linkLine(String link) {
        return "<tr><td style=\"padding:26px 40px 0 40px;font-family:" + SANS + ";font-size:14px;"
            + "line-height:1.6;font-weight:600;word-break:break-all;\">"
            + "<a href=\"" + esc(link) + "\" style=\"color:" + VIOLET + ";text-decoration:none;\">"
            + esc(link) + "</a></td></tr>";
    }

    /** The quiet line under a button or a link. */
    private static String small(String text) {
        return "<tr><td style=\"padding:10px 40px 0 40px;font-family:" + SANS + ";font-size:13px;"
            + "line-height:1.55;color:" + MUTED + ";\">" + esc(text) + "</td></tr>";
    }


    /** Sent when an admin moves a referral to demo_booked. */
    public static EmailMessage referralDemoBooked(String to, String hotelName, String statusUrl) {
        String hotel = hotelName == null || hotelName.isBlank() ? "A hotel you referred" : hotelName;
        String rows = heading("The hotel you referred just booked a demo")
                + para(hotel + " has booked a call with us. Nothing for you to do. "
                    + "We will let you know if they go live.")
                + button(statusUrl, "See your referrals");
        String text = "The hotel you referred just booked a demo\n\n"
                + hotel + " has booked a call with us. Nothing for you to do. "
                + "We will let you know if they go live.\n\n"
                + statusUrl + "\n";
        return new EmailMessage(
                to, "The hotel you referred just booked a demo", text, referralShell(rows), "Bliss");
    }

    /**
     * Sent when an admin moves a referral to live. This is the payout trigger.
     *
     * <p>TODO: the next-steps copy is a placeholder. Brad is writing how the
     * credit is claimed (whether we issue it against a booking the guest
     * already has, or hold it until they book). Until that is settled this
     * email promises the amount and says we will be in touch, which is true and
     * does not commit us to a mechanism.
     */
    public static EmailMessage referralLive(String to, String hotelName, String statusUrl) {
        String hotel = hotelName == null || hotelName.isBlank() ? "A hotel you referred" : hotelName;
        String subject = "You've earned up to $1,000 at " + hotel;
        // TODO(brad): replace the next two sentences with the real claim steps.
        String nextSteps = "We will email you shortly with how to use it.";
        String rows = heading(subject)
                + para(hotel + " is now taking Bliss, and that is down to you. "
                    + "You have earned up to $1,000 toward your next stay there.")
                + para(nextSteps)
                + button(statusUrl, "See your referrals");
        String text = subject + "\n\n"
                + hotel + " is now taking Bliss, and that is down to you. "
                + "You have earned up to $1,000 toward your next stay there.\n\n"
                + nextSteps + "\n\n"
                + statusUrl + "\n";
        return new EmailMessage(to, subject, text, referralShell(rows), "Bliss");
    }

    /** Sent when an admin moves a referral to credited. */
    public static EmailMessage referralCredited(String to, String hotelName, String statusUrl) {
        String hotel = hotelName == null || hotelName.isBlank() ? "the hotel you referred" : hotelName;
        String rows = heading("Your credit is ready")
                + para("Your credit for " + hotel + " has been applied. "
                    + "It comes off your next stay there.")
                + button(statusUrl, "See your referrals");
        String text = "Your credit is ready\n\n"
                + "Your credit for " + hotel + " has been applied. "
                + "It comes off your next stay there.\n\n"
                + statusUrl + "\n";
        return new EmailMessage(to, "Your credit is ready", text, referralShell(rows), "Bliss");
    }

    /**
     * The card these four sit in. Same shape as {@link #guestMagicLink}'s,
     * without the per-merchant footer, because a referral has no property
     * attached until the hotel is live.
     */
    /**
     * The three status emails further down the flow keep the short footer. Only
     * the kit email carries the "why you are getting this" line and the terms
     * link, because it is the one sent in response to something the guest did.
     */
    private static String referralShell(String innerRows) {
        return referralShell(innerRows, null);
    }

    /**
     * @param site marketing base URL for the terms link, or null for the short
     *     footer. Never a bare "" from a missing env var by accident: the caller
     *     passes what BLISS_MARKETING_BASE_URL resolved to, and a blank one
     *     degrades to the short footer rather than linking to a bare fragment.
     */
    private static String referralShell(String innerRows, String site) {
        return "<!DOCTYPE html>"
            + "<html><head><meta charset=\"utf-8\">"
            + "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
            + "<meta name=\"color-scheme\" content=\"light dark\">"
            + "<meta name=\"supported-color-schemes\" content=\"light dark\">"
            + "</head>"
            + "<body style=\"margin:0;padding:0;background-color:" + REFERRAL_GROUND + ";\">"
            // First thing in the body, before any visible markup, which is where
            // a client looks for the line to show beside the subject. Only the
            // kit mail sets one; the status mails say enough in their subject.
            + (site == null || site.isBlank() ? "" : preheader(PREHEADER_TEXT))
            + "<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\""
            + " style=\"background-color:" + REFERRAL_GROUND + ";margin:0;padding:0;\">"
            + "<tr><td align=\"center\" style=\"padding:32px 12px;\">"
            + "<table role=\"presentation\" width=\"600\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\""
            + " style=\"width:100%;max-width:600px;background-color:" + WHITE + ";"
            + "border:1px solid " + HAIRLINE + ";border-radius:16px;\">"
            + "<tr><td style=\"padding:32px 40px 0 40px;font-family:Georgia,'Times New Roman',serif;"
            + "font-size:26px;font-weight:bold;color:" + VIOLET + ";line-height:1;\">Bliss</td></tr>"
            + innerRows
            + "<tr><td style=\"padding:0 40px 36px 40px;\"></td></tr>"
            + "</table>"
            + "<table role=\"presentation\" width=\"600\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\""
            + " style=\"width:100%;max-width:600px;\">"
            + "<tr><td style=\"padding:20px 40px 8px 40px;font-family:" + SANS + ";font-size:12px;"
            + "line-height:1.6;color:" + MUTED + ";\">"
            + (site == null || site.isBlank()
                ? "Sent by Bliss"
                : "You're getting this because you asked for a referral link at "
                  + "bliss-payments.com. Questions? Email "
                  + "<a href=\"mailto:info@bliss-payments.com\" style=\"color:" + MUTED + ";\">"
                  + "info@bliss-payments.com</a>."
                  + "<br><a href=\"" + esc(site + REFERRAL_TERMS_PATH) + "\" style=\"color:" + MUTED
                  + ";\">Terms</a>")
            + "</td></tr></table>"
            + "</td></tr></table></body></html>";
    }
}
