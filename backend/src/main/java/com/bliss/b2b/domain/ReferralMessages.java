package com.bliss.b2b.domain;

import java.util.List;

/**
 * The three ways a guest can ask a hotel, written as the guest.
 *
 * <p>Defined once, here, because two surfaces render them and they must not
 * drift: the "Your Bliss referral link" email builds its mailto button, its DM
 * box and its front desk line from these, and the guest's status page at
 * /referrals/{token} shows the same three. Neither holds a copy of its own.
 *
 * <p>The guest page itself no longer renders them at all. After a submit it
 * shows a "check your inbox" confirmation, because the email is now where the
 * messages live and putting them on the page as well gave the guest two places
 * to act from and us two copies to keep in step.
 *
 * <p>COPY RULES, which apply to every string in this file. No em dashes. No
 * colons used as connectors, the only ones allowed being inside a URL or an
 * email Subject header. No "pay in 4" framing. Nothing about saving. No figures
 * at all, including the $1,000, which is the guest's reward and none of the
 * hotel's business. Above all, nothing that reads as a vendor pitch. A hotel
 * receiving this should hear one of its own guests asking for something,
 * because that is what is happening.
 */
public final class ReferralMessages {

    private ReferralMessages() {}

    /** Goes in the mailto's subject parameter and nowhere else. */
    public static final String EMAIL_SUBJECT = "Can I pay for my stay in installments?";

    public static Kit forLink(String link) {
        return new Kit(
                new Message(
                        "email",
                        "Email",
                        EMAIL_SUBJECT,
                        """
                        Hi there,

                        I'd like to book a stay with you, but I'd prefer to split the \
                        cost into a few payments.

                        Bliss lets hotels offer that at checkout. Would you consider \
                        adding it? Here's their site.
                        %s

                        Thanks""".formatted(link)),
                new Message(
                        "instagram",
                        "Instagram DM",
                        null,
                        """
                        Hi! I'd love to book a stay with you but would prefer to split \
                        the cost into installments. Bliss lets hotels offer that. Any \
                        chance you'd add it? %s""".formatted(link)),
                new Message(
                        "desk",
                        "At the front desk",
                        null,
                        """
                        Mention you'd like to book but would rather pay in installments, \
                        ask if they'd look into Bliss, and show them your link.
                        %s""".formatted(link)));
    }

    /**
     * @param id      stable key each surface uses to find its own message
     * @param label   what the guest sees above the message
     * @param subject only the email has one; null elsewhere
     * @param body    the text of the message itself
     */
    public record Message(String id, String label, String subject, String body) {}

    public record Kit(Message email, Message instagram, Message desk) {
        public List<Message> all() {
            return List.of(email, instagram, desk);
        }
    }
}
