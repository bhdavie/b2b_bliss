package com.bliss.b2b.service;

import com.bliss.b2b.BlissConfiguration.FeaturesConfig;
import com.bliss.b2b.domain.BlissSettings;
import com.bliss.b2b.domain.Merchant;
import com.bliss.b2b.domain.MewsConnection;
import com.bliss.b2b.domain.PmsType;
import com.bliss.b2b.payments.AfterRetriesAction;
import com.bliss.b2b.payments.DepositType;
import com.bliss.b2b.payments.MerchantPlanRules;
import com.bliss.b2b.payments.Money;
import com.bliss.b2b.payments.PayoutMode;
import com.bliss.b2b.payments.PlanEligibilityService;
import com.bliss.b2b.payments.PlanFrequency;
import com.bliss.b2b.payments.ReleasePolicy;
import com.bliss.b2b.persistence.BlissSettingsDao;
import com.bliss.b2b.persistence.MerchantFeeRateDao;
import com.bliss.b2b.persistence.MerchantMewsConnectionDao;
import com.bliss.b2b.persistence.MerchantPlanRulesDao;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * One view of everything that governs how Bliss runs for a property
 * (configurable-property spec, section 4), whatever stores it: the property's
 * own settings (V38), its plan rules, its fee rate, and what its PMS or Stripe
 * account says. Every setting has a value even for a property that has
 * configured nothing, which is what lets Bliss work the moment it is switched
 * on.
 *
 * <p>Only the settings this class owns are changed through it (payout mode,
 * release point, chargeback buffer). Plan rules keep their own endpoint, and
 * values sourced from Mews or Stripe are read-only here.
 */
public class BlissSettingsService {

    /** Where a value comes from, shown to the hotel next to it. */
    public static final String SOURCE_DEFAULT = "default";
    public static final String SOURCE_HOTEL = "hotel";
    public static final String SOURCE_MEWS = "mews";
    public static final String SOURCE_CLOUDBEDS = "cloudbeds";
    public static final String SOURCE_STRIPE = "stripe";
    public static final String SOURCE_BLISS = "bliss";

    private final BlissSettingsDao settingsDao;
    private final MerchantPlanRulesDao planRulesDao;
    private final MerchantFeeRateDao feeRateDao;
    private final MerchantMewsConnectionDao mewsConnectionDao;
    private final com.bliss.b2b.persistence.BlissRateDao blissRateDao;
    private final FeaturesConfig features;
    private final Clock clock;

    public BlissSettingsService(BlissSettingsDao settingsDao, MerchantPlanRulesDao planRulesDao,
            MerchantFeeRateDao feeRateDao, MerchantMewsConnectionDao mewsConnectionDao,
            com.bliss.b2b.persistence.BlissRateDao blissRateDao, FeaturesConfig features, Clock clock) {
        this.settingsDao = settingsDao;
        this.planRulesDao = planRulesDao;
        this.feeRateDao = feeRateDao;
        this.mewsConnectionDao = mewsConnectionDao;
        this.blissRateDao = blissRateDao;
        this.features = features;
        this.clock = clock;
    }

    /** The property's own settings, or the defaults when it has no row. */
    public BlissSettings settingsFor(UUID merchantId) {
        return settingsDao.find(merchantId).orElseGet(() -> BlissSettings.defaults(merchantId));
    }

    /**
     * Switches Bliss on: creates the row of defaults if there is none and
     * records when. Idempotent; switching on again keeps the first time.
     */
    public SettingsView enable(Merchant merchant) {
        settingsDao.insertDefaults(merchant.id());
        settingsDao.markEnabled(merchant.id(), clock.instant());
        return view(merchant);
    }

    /**
     * Changes the settings this class owns. Null fields are left as they are.
     *
     * @throws SettingsException {@code hold_mode_unavailable} while hold mode is
     *         not switched on for Bliss, {@code invalid_setting} for a bad value
     */
    public SettingsView update(Merchant merchant, String payoutMode, String releasePolicy,
            Integer chargebackBufferDays) {
        return update(merchant, payoutMode, releasePolicy, chargebackBufferDays, null, null, null);
    }

    /**
     * As above, plus where and how the Bliss fee line posts. For the three fee
     * fields, null leaves a value as it is and a blank string clears it (a
     * cleared tax code means untaxed).
     */
    public SettingsView update(Merchant merchant, String payoutMode, String releasePolicy,
            Integer chargebackBufferDays, String feeServiceId, String feeTaxCode, String feeAccountingCategoryId) {
        BlissSettings current = settingsFor(merchant.id());
        PayoutMode mode;
        ReleasePolicy policy;
        try {
            mode = payoutMode == null ? current.payoutMode() : PayoutMode.fromWire(payoutMode);
            policy = releasePolicy == null ? current.releasePolicy() : ReleasePolicy.fromWire(releasePolicy);
        } catch (IllegalArgumentException e) {
            throw new SettingsException("invalid_setting", e.getMessage());
        }
        int buffer = chargebackBufferDays == null ? current.chargebackBufferDays() : chargebackBufferDays;
        if (buffer < 0 || buffer > 30) {
            throw new SettingsException("invalid_setting", "The chargeback buffer must be 0 to 30 days.");
        }
        if (mode == PayoutMode.HOLD && current.payoutMode() != PayoutMode.HOLD) {
            if (!features.isHoldMode()) {
                // TODO(D3): hold mode stays off until Stripe confirms the
                // maximum hold period.
                throw new SettingsException("hold_mode_unavailable",
                        "Holding payments until they're yours isn't available yet.");
            }
            // Held money is released to an Express account (D6), paid out by ACH.
            if (merchant.stripeConnectAccountId() == null || merchant.stripeConnectAccountId().isBlank()
                    || !"charges_enabled".equals(merchant.stripeConnectStatus())) {
                throw new SettingsException("express_onboarding_required",
                        "Finish setting up your Stripe payouts account first.");
            }
            if (!"USD".equalsIgnoreCase(merchant.currency())) {
                throw new SettingsException("hold_mode_us_only",
                        "Holding payments is available for properties paid in US dollars for now.");
            }
            // So a refund that leaves the hotel owing the Bliss fee (D9) can be
            // recovered from its bank. Without it the switch doesn't happen.
            try {
                holdAccountSetup.prepare(merchant.stripeConnectAccountId());
            } catch (Exception e) {
                throw new SettingsException("stripe_setup_failed",
                        "Stripe couldn't finish setting up your account for held payments. Please try again.");
            }
        }
        settingsDao.insertDefaults(merchant.id());
        settingsDao.update(merchant.id(), mode.wire(), policy.wire(), buffer);
        if (feeServiceId != null || feeTaxCode != null || feeAccountingCategoryId != null) {
            settingsDao.updateFeeLine(merchant.id(),
                    pick(feeServiceId, current.feeServiceId()),
                    pick(feeTaxCode, current.feeTaxCode()),
                    pick(feeAccountingCategoryId, current.feeAccountingCategoryId()));
        }
        return view(merchant);
    }

    /**
     * What a property's Express account needs before it holds payments: Stripe
     * set to pull a negative balance from its bank. A no-op where Stripe isn't
     * wired (tests, demo).
     */
    public interface HoldAccountSetup {
        void prepare(String expressAccountId) throws Exception;
    }

    private HoldAccountSetup holdAccountSetup = accountId -> { };

    public BlissSettingsService withHoldAccountSetup(HoldAccountSetup setup) {
        this.holdAccountSetup = setup;
        return this;
    }

    /**
     * The Mews external payment type hold-mode ledger payments post as (D16).
     * Blank clears it, which makes ledger payments wait.
     */
    public SettingsView setLedgerPaymentType(Merchant merchant, String type) {
        String value = type == null || type.isBlank() ? null : type.trim();
        if (value != null && !value.matches("[A-Za-z]{1,64}")) {
            throw new SettingsException("invalid_setting", "Choose one of your Mews external payment types.");
        }
        settingsDao.insertDefaults(merchant.id());
        settingsDao.updateLedgerPaymentType(merchant.id(), value);
        return view(merchant);
    }

    /** Every setting, with its value, where it comes from, and whether it can be changed here. */
    public SettingsView view(Merchant merchant) {
        BlissSettings settings = settingsFor(merchant.id());
        Optional<MerchantPlanRules> storedRules = planRulesDao.findByMerchantId(merchant.id());
        MerchantPlanRules rules = storedRules.orElse(MerchantPlanRules.DEFAULTS);
        String rulesSource = storedRules.isPresent() ? SOURCE_HOTEL : SOURCE_DEFAULT;
        String ownSource = settings.stored() ? SOURCE_HOTEL : SOURCE_DEFAULT;
        String propertySource = propertySource(merchant);
        Optional<MewsConnection> mews = merchant.pmsType() == PmsType.MEWS
                ? mewsConnectionDao.findByMerchant(merchant.id())
                : Optional.empty();

        List<Setting> out = new ArrayList<>();

        // How you get paid.
        out.add(new Setting("payoutMode", "payouts", "How you get paid",
                "Pay as you go sends each payment straight to you as it's collected. Holding sends you "
                        + "each booking's money once it can no longer be refunded.",
                settings.payoutMode().wire(), payoutModeLabel(settings.payoutMode()), ownSource, true,
                List.of(new Option(PayoutMode.PAY_AS_YOU_GO.wire(), payoutModeLabel(PayoutMode.PAY_AS_YOU_GO),
                                true, null),
                        new Option(PayoutMode.HOLD.wire(), payoutModeLabel(PayoutMode.HOLD), features.isHoldMode(),
                                features.isHoldMode() ? null : "Coming soon"))));
        out.add(new Setting("releasePolicy", "payouts", "When held money is sent to you",
                "Only used when payments are held. Money is sent once it can no longer be refunded.",
                settings.releasePolicy().wire(), releasePolicyLabel(settings.releasePolicy()), ownSource, true,
                List.of(new Option(ReleasePolicy.CANCELLATION_DEADLINE.wire(),
                                releasePolicyLabel(ReleasePolicy.CANCELLATION_DEADLINE), true, null),
                        new Option(ReleasePolicy.CHECK_IN.wire(), releasePolicyLabel(ReleasePolicy.CHECK_IN), true, null),
                        new Option(ReleasePolicy.ON_COLLECTION.wire(),
                                releasePolicyLabel(ReleasePolicy.ON_COLLECTION), true, null))));
        out.add(new Setting("chargebackBufferDays", "payouts", "Wait after each payment clears",
                "Only used when held money is sent as each payment clears. A short wait in case the guest's "
                        + "bank disputes the payment.",
                settings.chargebackBufferDays(), days(settings.chargebackBufferDays()), ownSource, true, null));
        if (merchant.pmsType() == PmsType.MEWS) {
            out.add(new Setting("ledgerPaymentType", "payouts", "How released money shows in Mews",
                    "Only used when payments are held. Each release is recorded on the guest's folio as a "
                            + "payment of this type, so the folio balances. Agree it with your accounting team.",
                    settings.ledgerPaymentType(),
                    settings.ledgerPaymentType() == null ? "Not chosen yet" : settings.ledgerPaymentType(),
                    settings.ledgerPaymentType() == null ? SOURCE_DEFAULT : SOURCE_HOTEL, true, null));
        }

        // Synced from the property's systems.
        out.add(new Setting("currency", "synced", "Currency",
                "Every amount is in this currency.",
                merchant.currency(), merchant.currency() == null ? "Not set yet" : merchant.currency(),
                propertySource, false, null));
        out.add(new Setting("timeZone", "synced", "Time zone",
                "Payment due dates and release dates are days in this time zone.",
                merchant.timeZone(), merchant.timeZone() == null ? "Not set yet" : merchant.timeZone(),
                propertySource, false, null));
        out.add(new Setting("language", "synced", "Language for guest emails",
                "Amounts and dates in guest emails are written this way.",
                merchant.localeTag(), merchant.localeTag() == null ? "Plain English" : merchant.localeTag(),
                propertySource, false, null));
        if (mews.isPresent()) {
            MewsConnection c = mews.get();
            out.add(new Setting("blissRates", "synced", "Your Bliss rates",
                    "Guests choose a payment plan by booking one of these rates in Mews.",
                    blissRatesValue(c), blissRatesLabel(c), SOURCE_MEWS, false, null));
            // Each Bliss rate's booking type, from its Mews cancellation policy.
            for (com.bliss.b2b.domain.BlissRate rate : blissRateDao.listForMerchant(merchant.id())) {
                String name = rate.rateName() == null ? rate.mewsRateId() : rate.rateName().trim();
                String terms = rate.syncedAt() == null ? "Not synced yet" : rate.terms().describe();
                out.add(new Setting("bookingType:" + rate.mewsRateId(), "synced",
                        "Booking type for " + name,
                        "Whether guests get money back if they cancel. Bliss follows the rate's cancellation "
                                + "policy in Mews; you can override it.",
                        rate.bookingType().wire(),
                        bookingTypeLabel(rate.bookingType()) + ". " + terms,
                        rate.override() != null ? SOURCE_HOTEL : SOURCE_MEWS, true,
                        List.of(new Option("refundable", "Refundable", true, null),
                                new Option("non_refundable", "Non-refundable", true, null))));
            }
        }

        // Plans.
        out.add(new Setting("deposit", "plans", "Upfront payment",
                "What the guest pays when they book.",
                depositValue(merchant, rules), depositLabel(merchant, rules),
                merchant.pmsType() == PmsType.MEWS ? SOURCE_MEWS : rulesSource,
                merchant.pmsType() != PmsType.MEWS, null));
        out.add(new Setting("paymentSchedules", "plans", "Payment schedules offered",
                "Which payment plans guests can choose from.",
                rules.allowedFrequencies().wire(), schedulesLabel(rules), rulesSource, true, null));
        out.add(new Setting("minLeadTimeWeeks", "plans", "How far ahead guests can start a plan",
                "Guests can choose a plan only for stays at least this far away.",
                rules.minLeadTimeWeeks(), weeks(rules.minLeadTimeWeeks()) + " or more before arrival",
                rulesSource, true, null));
        int finalDays = Math.max(PlanEligibilityService.MIN_FINAL_PAYMENT_BUFFER_DAYS, rules.paymentDueOffsetDays());
        out.add(new Setting("finalPaymentDue", "plans", "Last payment due",
                "The final payment is taken this long before arrival, leaving time to retry if it fails.",
                finalDays, days(finalDays) + " before check-in", rulesSource, true, null));
        out.add(new Setting("retries", "plans", "Failed payments",
                "How often Bliss tries again when a payment doesn't go through.",
                rules.retryAttempts(), retriesLabel(rules), rulesSource, true, null));
        out.add(new Setting("afterRetries", "plans", "After the last try fails",
                "What happens if every retry fails.",
                rules.afterRetriesAction().wire(), afterRetriesLabel(rules.afterRetriesAction()), rulesSource,
                true, null));
        out.add(new Setting("refundPolicy", "plans", "When a guest cancels",
                "What a guest gets back if they cancel.",
                rules.refundPolicy().wire(), refundPolicyLabel(rules), rulesSource, true, null));

        // Fees.
        Optional<BigDecimal> storedFee = feeRateDao.effectiveRateFor(merchant.id(), clock.instant());
        BigDecimal fee = storedFee.orElse(PlanCreationService.FALLBACK_FEE_RATE_PUBLIC);
        out.add(new Setting("blissFee", "fees", "Bliss fee",
                "Added to each plan, so the guest pays it, not you.",
                fee, percent(fee) + " of each plan", storedFee.isPresent() ? SOURCE_BLISS : SOURCE_DEFAULT,
                false, null));
        boolean feeLineReady = features.isFeeFolioLine() && settings.feeServiceId() != null;
        out.add(new Setting("feeOnFolio", "fees", "Bliss fee on the folio",
                "The fee appears as its own line on the guest's folio, alongside other fees.",
                feeLineReady,
                !features.isFeeFolioLine() ? "Off"
                        : feeLineReady ? "Shown as \"Bliss service fee\""
                        : merchant.pmsType() == PmsType.MEWS ? "Needs a Mews service to post under"
                        : "Not used without Mews",
                SOURCE_BLISS, false, null));
        if (merchant.pmsType() == PmsType.MEWS) {
            out.add(new Setting("feeService", "fees", "Mews service for the Bliss fee",
                    "Mews adds charges like the Bliss fee under a service. Bliss uses one named \"Bliss\" if "
                            + "you have one.",
                    settings.feeServiceId(), settings.feeServiceId() == null ? "Not chosen yet"
                            : settings.feeServiceId(),
                    settings.feeServiceId() == null ? SOURCE_DEFAULT : SOURCE_HOTEL, true, null));
            out.add(new Setting("feeTaxCode", "fees", "Tax on the Bliss fee",
                    "The Mews tax rate applied to the fee line. Untaxed until you choose one.",
                    settings.feeTaxCode(), settings.feeTaxCode() == null ? "Untaxed" : settings.feeTaxCode(),
                    settings.feeTaxCode() == null ? SOURCE_DEFAULT : SOURCE_HOTEL, true, null));
        }

        // Emails.
        out.add(new Setting("guestEmails", "emails", "Guest emails",
                "Plan confirmation, receipts, reminders and payment problems.",
                true, "On", SOURCE_DEFAULT, false, null));

        return new SettingsView(settings.enabled(), settings.blissEnabledAt(), out);
    }

    private static String propertySource(Merchant merchant) {
        return switch (merchant.pmsType()) {
            case MEWS -> SOURCE_MEWS;
            case CLOUDBEDS -> SOURCE_CLOUDBEDS;
            case STRIPE -> SOURCE_STRIPE;
            case NONE -> merchant.currency() == null ? SOURCE_DEFAULT : SOURCE_HOTEL;
        };
    }

    static String bookingTypeLabel(com.bliss.b2b.payments.BookingType type) {
        return type == com.bliss.b2b.payments.BookingType.NON_REFUNDABLE ? "Non-refundable" : "Refundable";
    }

    /** A new value for a nullable setting: null keeps {@code current}, blank clears it. */
    private static String pick(String requested, String current) {
        if (requested == null) return current;
        return requested.isBlank() ? null : requested.trim();
    }

    static String payoutModeLabel(PayoutMode mode) {
        return mode == PayoutMode.HOLD ? "Hold until it's yours" : "Pay as you go";
    }

    static String releasePolicyLabel(ReleasePolicy policy) {
        return switch (policy) {
            case CANCELLATION_DEADLINE -> "When free cancellation ends";
            case CHECK_IN -> "At check-in";
            case ON_COLLECTION -> "As each payment clears";
        };
    }

    private static Object blissRatesValue(MewsConnection c) {
        java.util.Map<String, String> rates = new java.util.LinkedHashMap<>();
        if (c.blissMonthlyRateId() != null) rates.put("monthly", c.blissMonthlyRateId());
        if (c.blissBiweeklyRateId() != null) rates.put("biweekly", c.blissBiweeklyRateId());
        return rates;
    }

    private static String blissRatesLabel(MewsConnection c) {
        if (c.blissMonthlyRateId() == null && c.blissBiweeklyRateId() == null) {
            return "None chosen yet";
        }
        List<String> parts = new ArrayList<>();
        if (c.blissMonthlyRateId() != null) parts.add("Monthly");
        if (c.blissBiweeklyRateId() != null) parts.add("Every 2 weeks");
        return String.join(" and ", parts);
    }

    private static Object depositValue(Merchant merchant, MerchantPlanRules rules) {
        if (merchant.pmsType() == PmsType.MEWS) return "mews_rate";
        if (!rules.depositRequired() || rules.depositType() == null) return "none";
        return rules.depositType().wire() + ":" + rules.depositValue();
    }

    private static String depositLabel(Merchant merchant, MerchantPlanRules rules) {
        if (merchant.pmsType() == PmsType.MEWS) {
            return "Whatever your Bliss rate charges at booking";
        }
        if (!rules.depositRequired() || rules.depositType() == null || rules.depositValue() == null) {
            return "None";
        }
        if (rules.depositType() == DepositType.PERCENTAGE) {
            return rules.depositValue() + "% of the stay";
        }
        return merchant.currency() == null
                ? rules.depositValue() + " (minor units)"
                : Money.format(rules.depositValue(), merchant.currency(), merchant.localeTag());
    }

    private static String schedulesLabel(MerchantPlanRules rules) {
        return switch (rules.allowedFrequencies()) {
            case MONTHLY -> "Monthly";
            case BIWEEKLY -> "Every 2 weeks";
            case BOTH -> {
                PlanFrequency recommended = rules.resolveRecommended();
                yield "Every 2 weeks and monthly"
                        + (recommended == null ? "" : " (" + (recommended == PlanFrequency.MONTHLY
                                ? "monthly" : "every 2 weeks") + " recommended)");
            }
        };
    }

    private static String retriesLabel(MerchantPlanRules rules) {
        if (rules.retryAttempts() <= 0) return "Not retried";
        return rules.retryAttempts() + (rules.retryAttempts() == 1 ? " try" : " tries") + ", "
                + days(rules.retrySpacingDays()) + " apart";
    }

    private static String afterRetriesLabel(AfterRetriesAction action) {
        return switch (action) {
            case TREAT_AS_CANCELLATION -> "Treat it as a cancellation";
            case BALANCE_DUE_AT_CHECKIN -> "The balance is due at check-in";
        };
    }

    private static String refundPolicyLabel(MerchantPlanRules rules) {
        return switch (rules.refundPolicy()) {
            case FULL -> "Full refund of what they've paid";
            case NONE -> "No refund";
            case FIRST_INSTALLMENT_ONLY -> "Refund of the first payment only";
            case SLIDING_SCALE -> "Full refund until "
                    + (rules.refundSlidingThresholdPercent() == null ? 50 : rules.refundSlidingThresholdPercent())
                    + "% is paid, then none";
            case CREDIT_ONLY -> "Credit toward a future stay";
        };
    }

    private static String percent(BigDecimal rate) {
        return rate.movePointRight(2).setScale(2, RoundingMode.HALF_UP).stripTrailingZeros().toPlainString() + "%";
    }

    private static String days(int n) {
        return n + (n == 1 ? " day" : " days");
    }

    private static String weeks(int n) {
        return n + (n == 1 ? " week" : " weeks");
    }

    /** All settings, plus whether Bliss is switched on for the property. */
    public record SettingsView(boolean enabled, Instant enabledAt, List<Setting> settings) {
    }

    /**
     * One setting as the hotel sees it. {@code display} is plain language;
     * {@code value} is the machine value; {@code source} is one of the SOURCE_
     * constants; {@code options} lists choices for editable choice settings.
     */
    public record Setting(String key, String group, String label, String help, Object value, String display,
            String source, boolean editable, List<Option> options) {
    }

    /** A choice for a setting. {@code available} false with a {@code note} such as "Coming soon". */
    public record Option(String value, String label, boolean available, String note) {
    }

    /** A rejected change, with a wire code and a message for the hotel. */
    public static class SettingsException extends RuntimeException {
        private final String code;

        public SettingsException(String code, String message) {
            super(message);
            this.code = code;
        }

        public String code() {
            return code;
        }
    }
}
