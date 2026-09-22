package com.bliss.b2b.domain;

import java.util.List;

/**
 * The three messages a guest can send a hotel, written as the guest.
 *
 * <p>Defined once, here, because two surfaces render them and they must not
 * drift: the "Your Bliss referral link" email includes all three, and the
 * marketing site shows the same three behind copy buttons. The site does not
 * hold its own copy; it renders what {@code /start} and {@code /status} return.
 *
 * <p>COPY RULES, which apply to every string in this file. No em dashes. No
 * colons used as connectors. No "pay in 4" framing. Nothing about saving or
 * saving up. No figures at all, including the $1,000, which is the guest's
 * reward and none of the hotel's business. Above all, nothing that reads as a
 * vendor pitch. A hotel receiving this should hear one of its own guests asking
 * for something, because that is what is happening.
 */
public final class ReferralMessages {

    private ReferralMessages() {}

    public static final String EMAIL_SUBJECT = "Could I split payments when I book with you?";

    public static Kit forLink(String link) {
        return new Kit(
                new Message(
                        "email",
                        "Email",
                        EMAIL_SUBJECT,
                        """
                        Hi there,

                        I've stayed with you before and I'd book direct more often if I \
                        could spread the cost over a few payments instead of paying all \
                        of it at once.

                        A company called Bliss does this for independent hotels. It runs \
                        on the checkout you already have, it costs you nothing, and your \
                        cancellation policy stays exactly as it is.

                        Here is the link if you want to take a look.
                        %s

                        Thanks,
                        [your name]""".formatted(link)),
                new Message(
                        "instagram",
                        "Instagram DM",
                        null,
                        """
                        I'd book direct with you more often if I could split the payment \
                        into a few installments instead of paying all at once. A company \
                        called Bliss does this for independent hotels at no cost to the \
                        property, the link is %s""".formatted(link)),
                new Message(
                        "desk",
                        "At the desk",
                        null,
                        """
                        "I'd book here direct more often if I could pay for a stay in a \
                        few installments."

                        "There's a company called Bliss that sets that up for independent \
                        hotels, and it doesn't cost the property anything."

                        Then give them this link.
                        %s""".formatted(link)));
    }

    /**
     * @param id      stable key the frontend uses for its copy buttons
     * @param label   what the guest sees above the message
     * @param subject only the email has one; null elsewhere
     * @param body    the text the copy button puts on the clipboard
     */
    public record Message(String id, String label, String subject, String body) {}

    public record Kit(Message email, Message instagram, Message desk) {
        public List<Message> all() {
            return List.of(email, instagram, desk);
        }
    }
}
