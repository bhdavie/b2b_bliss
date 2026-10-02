package com.bliss.b2b.integration;

import com.bliss.b2b.domain.Merchant;
import java.util.Arrays;
import java.util.Locale;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Which properties always run Stripe in demo mode, whatever keys are set:
 * a property is a demo when its Connect account is a synthetic
 * {@code acct_demo_*}, when it is a listed demo Mews property
 * ({@code BLISS_DEMO_MEWS_SLUGS}), or when its login is a demo login
 * ({@code BLISS_DEMO_LOGIN_EMAILS}). In production that is every Marbrook
 * property. Demo properties get synthetic customers, cards and payments and
 * never reach Stripe, so setting live keys never charges a card for them.
 */
public final class StripeDemoPolicy {

    public static final StripeDemoPolicy NONE = new StripeDemoPolicy("", "");

    private final Set<String> demoSlugs;
    private final Set<String> demoEmails;

    public StripeDemoPolicy(String demoSlugsCsv, String demoEmailsCsv) {
        this.demoSlugs = split(demoSlugsCsv, false);
        this.demoEmails = split(demoEmailsCsv, true);
    }

    public boolean isDemo(Merchant merchant) {
        if (merchant == null) {
            return false;
        }
        return isDemoAccount(merchant.stripeConnectAccountId())
                || (merchant.slug() != null && demoSlugs.contains(merchant.slug()))
                || (merchant.email() != null && demoEmails.contains(merchant.email().trim().toLowerCase(Locale.ROOT)));
    }

    /** A synthetic Connect account id, never a real one. */
    public static boolean isDemoAccount(String accountId) {
        return accountId != null && accountId.startsWith("acct_demo_");
    }

    /** Synthetic customer, card, SetupIntent or PaymentIntent ids Bliss mints in demo mode. */
    public static boolean isDemoId(String id) {
        return id != null && (id.contains("_demo_") || id.startsWith("pm_seed_") || id.startsWith("cus_seed_"));
    }

    private static Set<String> split(String csv, boolean lower) {
        if (csv == null || csv.isBlank()) {
            return Set.of();
        }
        return Arrays.stream(csv.split(",")).map(String::trim).filter(s -> !s.isEmpty())
                .map(s -> lower ? s.toLowerCase(Locale.ROOT) : s).collect(Collectors.toUnmodifiableSet());
    }
}
