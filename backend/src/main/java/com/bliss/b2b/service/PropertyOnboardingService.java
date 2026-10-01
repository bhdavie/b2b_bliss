package com.bliss.b2b.service;

import com.bliss.b2b.domain.Merchant;
import com.bliss.b2b.domain.MewsConnection;
import com.bliss.b2b.domain.OnboardingState;
import com.bliss.b2b.domain.PmsType;
import com.bliss.b2b.domain.CloudbedsConnection;
import com.bliss.b2b.domain.StripeConnection;
import com.bliss.b2b.integration.pms.MewsAdapter;
import com.bliss.b2b.integration.pms.MewsAdapterFactory;
import com.bliss.b2b.integration.pms.MewsCatalog;
import com.bliss.b2b.integration.pms.MewsPlatform;
import com.bliss.b2b.integration.pms.PmsAdapterException;
import com.bliss.b2b.integration.pms.PmsPropertyConfiguration;
import com.bliss.b2b.payments.Money;
import com.bliss.b2b.persistence.MerchantCloudbedsConnectionDao;
import com.bliss.b2b.persistence.MerchantDao;
import com.bliss.b2b.persistence.MerchantMewsConnectionDao;
import com.bliss.b2b.persistence.MewsLinkingDao;
import com.bliss.b2b.persistence.MerchantStripeConnectionDao;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Drives the resumable property onboarding state machine
 * ({@link OnboardingState}) and the Mews connection validation. Transitions are
 * forward-only: {@link #advanceTo} never downgrades a property, so re-running a
 * step is idempotent.
 */
public class PropertyOnboardingService {

    private static final Logger log = LoggerFactory.getLogger(PropertyOnboardingService.class);

    private final MerchantDao merchantDao;
    private final MerchantMewsConnectionDao connectionDao;
    private final MerchantStripeConnectionDao stripeConnectionDao;
    private final MerchantCloudbedsConnectionDao cloudbedsConnectionDao;
    private final MewsAdapterFactory mewsFactory;
    private final MewsLinkingDao linkingDao;
    private final Clock clock;

    public PropertyOnboardingService(
            MerchantDao merchantDao,
            MerchantMewsConnectionDao connectionDao,
            MerchantStripeConnectionDao stripeConnectionDao,
            MerchantCloudbedsConnectionDao cloudbedsConnectionDao,
            MewsAdapterFactory mewsFactory,
            MewsLinkingDao linkingDao,
            Clock clock) {
        this.linkingDao = linkingDao;
        this.merchantDao = merchantDao;
        this.connectionDao = connectionDao;
        this.stripeConnectionDao = stripeConnectionDao;
        this.cloudbedsConnectionDao = cloudbedsConnectionDao;
        this.mewsFactory = mewsFactory;
        this.clock = clock;
    }

    /** The property's current onboarding status + checklist. */
    public OnboardingStatus status(Merchant merchant) {
        OnboardingState state = merchant.onboardingState();
        MewsInfo mews = null;
        if (merchant.pmsType() == PmsType.MEWS) {
            MewsConnection conn = connectionDao.findByMerchant(merchant.id()).orElse(null);
            mews = new MewsInfo(
                    conn != null && conn.isValidated(),
                    conn == null ? null : conn.enterpriseName(),
                    conn == null ? null : conn.currency(),
                    conn != null && conn.isLinkingReady());
        }
        StripeInfo stripe = null;
        if (merchant.pmsType() == PmsType.STRIPE) {
            StripeConnection conn = stripeConnectionDao.findByMerchant(merchant.id()).orElse(null);
            stripe = new StripeInfo(
                    conn != null && conn.isChargesEnabled(),
                    conn == null ? null : conn.connectStatus(),
                    conn == null ? null : conn.stripeAccountId());
        }
        CloudbedsInfo cloudbeds = null;
        if (merchant.pmsType() == PmsType.CLOUDBEDS) {
            CloudbedsConnection conn = cloudbedsConnectionDao.findByMerchant(merchant.id()).orElse(null);
            cloudbeds = new CloudbedsInfo(
                    conn != null && conn.isConnected(),
                    conn == null ? null : conn.propertyName(),
                    conn == null ? null : conn.currency());
        }
        return new OnboardingStatus(
                state.wire(),
                merchant.pmsType().wire(),
                state == OnboardingState.ACTIVE,
                mews,
                stripe,
                cloudbeds,
                steps(state));
    }

    /**
     * Advances a Cloudbeds-rail property PMS_SELECTED -> PMS_CONNECTED once its
     * OAuth connection is stored. Called from the OAuth callback after a
     * successful code exchange + property identification. Also (re)asserts
     * pms_type=cloudbeds, mirroring {@link #connectMews}. Idempotent.
     */
    /**
     * Records a Stripe-rail property's currency and time zone from its
     * connected account ({@code default_currency}, {@code
     * settings.dashboard.timezone}). Stripe has no language setting, so the
     * locale is left as it is. An account that does not report a currency yet
     * (early in onboarding) changes nothing.
     */
    public void recordStripeAccountLocale(UUID merchantId, com.stripe.model.Account account) {
        recordStripeAccountLocale(merchantDao, merchantId, account);
    }

    /** Static form for resources that hold only a {@link MerchantDao}. */
    public static void recordStripeAccountLocale(
            MerchantDao merchantDao, UUID merchantId, com.stripe.model.Account account) {
        if (account == null || account.getDefaultCurrency() == null || account.getDefaultCurrency().isBlank()) {
            return;
        }
        String timeZone = account.getSettings() != null && account.getSettings().getDashboard() != null
                ? blankToNull(account.getSettings().getDashboard().getTimezone())
                : null;
        try {
            merchantDao.updatePropertyLocale(merchantId, Money.code(account.getDefaultCurrency()), timeZone, null);
        } catch (IllegalArgumentException e) {
            log.warn("Stripe account {} for merchant {} reports unusable currency '{}'",
                    account.getId(), merchantId, account.getDefaultCurrency());
        }
    }

    public void markCloudbedsConnected(UUID merchantId, PmsPropertyConfiguration property) {
        Merchant merchant = reload(merchantId);
        boolean connected = cloudbedsConnectionDao.findByMerchant(merchantId)
                .filter(CloudbedsConnection::isConnected)
                .isPresent();
        if (!connected) {
            return;
        }
        merchantDao.updatePmsType(merchantId, PmsType.CLOUDBEDS.wire());
        // Currency straight from Cloudbeds, never defaulted. A property that
        // reports none stays connected but cannot take bookings until it does.
        try {
            merchantDao.updatePropertyLocale(merchantId, Money.code(property.defaultCurrency()),
                    blankToNull(property.timeZoneIdentifier()), blankToNull(property.languageCode()));
        } catch (IllegalArgumentException e) {
            log.warn("Cloudbeds property for merchant {} reported no usable currency ({})",
                    merchantId, property.defaultCurrency());
        }
        advanceTo(merchant, OnboardingState.PMS_CONNECTED);
        log.info("Property {} connected Cloudbeds", merchantId);
    }

    /**
     * Advances a Stripe-rail property PMS_SELECTED -> PMS_CONNECTED once its
     * Standard connection can take charges. Idempotent, and a no-op unless the
     * property is on the Stripe rail with a charges-enabled connection.
     *
     * <p>No longer part of onboarding. The payment-processor connect step has
     * been removed from the funnel, and a new property now defaults to
     * {@link PmsType#NONE} rather than STRIPE, so nothing in the funnel reaches
     * this. It stays only so the Standard Connect endpoints keep working for the
     * properties already on that rail; onboarding completion no longer depends
     * on it for any property.
     */
    public void markStripeConnected(UUID merchantId) {
        Merchant merchant = reload(merchantId);
        if (merchant.pmsType() != PmsType.STRIPE) {
            return;
        }
        boolean chargesEnabled = stripeConnectionDao.findByMerchant(merchantId)
                .filter(StripeConnection::isChargesEnabled)
                .isPresent();
        if (chargesEnabled) {
            advanceTo(merchant, OnboardingState.PMS_CONNECTED);
        }
    }

    /**
     * Records the chosen PMS and advances to PMS_SELECTED. Stripe and Mews are
     * connectable; Cloudbeds is accepted but "coming soon" — it parks at
     * PMS_SELECTED and cannot reach PMS_CONNECTED.
     */
    public OnboardingStatus selectPms(Merchant merchant, PmsType pmsType) {
        // The funnel offers Mews and Cloudbeds. NONE is the not-yet-chosen
        // default and is not a choice; STRIPE is the legacy no-PMS rail whose
        // connect step has been removed, so selecting it would park the property
        // in front of a step that no longer exists. Reject both here rather than
        // at the resource, so the rule holds for every caller.
        if (!pmsType.isConnectable()) {
            throw new PropertyOnboardingException(
                    "unsupported_pms",
                    "Choose a property management system to connect.");
        }
        merchantDao.updatePmsType(merchant.id(), pmsType.wire());
        advanceTo(merchant, OnboardingState.PMS_SELECTED);
        Merchant updated = reload(merchant.id());
        log.info("Property {} selected pms={} (state {})",
                merchant.id(), pmsType.wire(), updated.onboardingState().wire());
        return status(updated);
    }

    /**
     * Validates Mews credentials by calling configuration/get, and on success
     * stores the connection (with the enterprise identity read back) and
     * advances to PMS_CONNECTED. Throws {@link PropertyOnboardingException} on a
     * failed validation, leaving state unchanged.
     */
    public MewsConnectResult connectMews(
            Merchant merchant, String platformUrl, String clientToken, String accessToken) {
        if (clientToken == null || clientToken.isBlank()
                || accessToken == null || accessToken.isBlank()) {
            throw new PropertyOnboardingException(
                    "missing_tokens", "Both a client token and an access token are required.");
        }
        // Required, and only a known Mews environment. No default: a blank url
        // used to fall back to the public demo, which would quietly validate a
        // real property's tokens against the wrong Mews.
        if (platformUrl == null || platformUrl.isBlank()) {
            throw new PropertyOnboardingException(
                    "missing_platform_url", "A Mews platform URL is required.");
        }
        String effectiveUrl = MewsPlatform.normalize(platformUrl).orElseThrow(() ->
                new PropertyOnboardingException(
                        "unsupported_platform_url",
                        "Use " + MewsPlatform.PRODUCTION_API + " for your live property, or "
                                + MewsPlatform.DEMO_API + " for the Mews demo."));

        MewsAdapter adapter = mewsFactory.adapterForCredentials(
                effectiveUrl, clientToken.trim(), accessToken.trim());
        PmsPropertyConfiguration cfg;
        try {
            cfg = adapter.getPropertyConfiguration();
        } catch (PmsAdapterException e) {
            log.info("Mews validation failed for property {}: {}", merchant.id(), e.getMessage());
            throw new PropertyOnboardingException(
                    "mews_connection_failed",
                    "Could not connect to Mews with those tokens. " + e.getMessage());
        }

        // The property's currency is whatever Mews says it is, and nothing
        // else: no fallback. An enterprise with no usable default currency
        // cannot be priced, so it is not connected.
        String currency;
        try {
            currency = Money.code(cfg.defaultCurrency());
        } catch (IllegalArgumentException e) {
            throw new PropertyOnboardingException("no_currency",
                    "Mews did not report a default currency for your property.");
        }
        PmsPropertyConfiguration validated = new PmsPropertyConfiguration(
                cfg.enterpriseId(), cfg.name(), currency, cfg.countryCode(), cfg.pricing(),
                cfg.timeZoneIdentifier(), cfg.languageCode());
        mewsFactory.saveValidatedConnection(
                merchant.id(), effectiveUrl, clientToken.trim(), accessToken.trim(),
                validated, Instant.now(clock));
        merchantDao.updatePmsType(merchant.id(), PmsType.MEWS.wire());
        merchantDao.updatePropertyLocale(merchant.id(), currency,
                blankToNull(cfg.timeZoneIdentifier()), blankToNull(cfg.languageCode()));
        advanceTo(merchant, OnboardingState.PMS_CONNECTED);

        log.info("Property {} connected Mews enterprise '{}' ({}, {}, {})",
                merchant.id(), cfg.name(), currency, cfg.timeZoneIdentifier(), cfg.languageCode());
        return new MewsConnectResult(cfg.name(), currency);
    }

    /**
     * What the property can choose from for its booking setup: its active stay
     * services and, for the chosen one, the rates Bliss could book. The service
     * shown is {@code serviceId} when given, else the stored one, else the only
     * active one. Reads Mews live; nothing is stored.
     */
    public MewsSetupOptions mewsSetupOptions(Merchant merchant, String serviceId) {
        MewsConnection conn = validatedConnection(merchant);
        MewsAdapter adapter = mewsFactory.adapterForConnection(conn);
        try {
            List<MewsCatalog.Service> services = adapter.getBookableServices().stream()
                    .filter(MewsCatalog.Service::active)
                    .toList();
            String selected = firstNonBlank(serviceId, conn.serviceId());
            if (selected == null && services.size() == 1) {
                selected = services.get(0).id();
            }
            List<MewsCatalog.Rate> rates = selected == null ? List.of()
                    : adapter.getRates(selected).stream().filter(MewsCatalog.Rate::bookable).toList();
            return new MewsSetupOptions(services, selected, rates,
                    conn.blissMonthlyRateId(), conn.blissBiweeklyRateId(),
                    conn.blissMonthlyDepositBps(), conn.blissBiweeklyDepositBps());
        } catch (PmsAdapterException e) {
            throw new PropertyOnboardingException("mews_unreachable",
                    "Could not read your Mews setup. " + e.getMessage());
        }
    }

    /**
     * Stores the property's Bliss rates: the stay service guests book in the
     * Mews booking engine, and the rate that stands for each payment schedule.
     * A guest who picks a plan in the Bliss pop-up books that schedule's rate;
     * the link pass reads the rate off the reservation to know the schedule.
     * At least one schedule is required, and the two rates must differ.
     *
     * <p>Each rate is checked against the property's live catalogue. A private
     * rate is accepted with a warning: the booking engine only shows it to
     * guests with its voucher code. The rate's payment policy (the percentage
     * Mews charges on confirmation) is set in Mews and is not visible here.
     *
     * <p>The first save also starts linking from now, so reservations made
     * before the property set Bliss up are never turned into plans.
     */
    public MewsSetupResult saveMewsSetup(Merchant merchant, String serviceId,
            String monthlyRateId, String biweeklyRateId,
            Integer monthlyDepositBps, Integer biweeklyDepositBps) {
        String monthly = blankToNull(monthlyRateId);
        String biweekly = blankToNull(biweeklyRateId);
        if (serviceId == null || serviceId.isBlank() || (monthly == null && biweekly == null)) {
            throw new PropertyOnboardingException("invalid_input",
                    "Choose a service and a Bliss rate for at least one payment schedule.");
        }
        checkDepositBps(monthlyDepositBps, "monthly");
        checkDepositBps(biweeklyDepositBps, "every 2 weeks");
        // A deposit shown for a schedule with no rate would never be shown.
        Integer monthlyBps = monthly == null ? null : monthlyDepositBps;
        Integer biweeklyBps = biweekly == null ? null : biweeklyDepositBps;
        if (monthly != null && monthly.equals(biweekly)) {
            throw new PropertyOnboardingException("same_rate",
                    "Each payment schedule needs its own rate, so Bliss can tell which one the guest chose.");
        }
        MewsConnection conn = validatedConnection(merchant);
        MewsAdapter adapter = mewsFactory.adapterForConnection(conn);
        try {
            boolean serviceOk = adapter.getBookableServices().stream()
                    .anyMatch(s -> s.active() && s.id().equals(serviceId));
            if (!serviceOk) {
                throw new PropertyOnboardingException("unknown_service",
                        "That service is not an active stay service in your Mews.");
            }
            List<MewsCatalog.Rate> rates = adapter.getRates(serviceId);
            List<String> warnings = new java.util.ArrayList<>();
            String monthlyName = checkRate(rates, monthly, "monthly", warnings);
            String biweeklyName = checkRate(rates, biweekly, "biweekly", warnings);
            String timeZone = adapter.getPropertyConfiguration().timeZoneIdentifier();
            if (timeZone == null || timeZone.isBlank()) {
                throw new PropertyOnboardingException("no_time_zone",
                        "Mews did not report a time zone for your property.");
            }
            linkingDao.updateBlissRates(merchant.id(), serviceId, monthly, biweekly,
                    monthlyBps, biweeklyBps, timeZone, clock.instant());
            merchantDao.updateTimeZone(merchant.id(), timeZone);
            log.info("Property {} Bliss rates on service {}: monthly {} ({}), biweekly {} ({}){}",
                    merchant.id(), serviceId, monthly, monthlyName, biweekly, biweeklyName,
                    warnings.isEmpty() ? "" : " warnings=" + warnings);
            return new MewsSetupResult(serviceId, monthly, monthlyName, monthlyBps,
                    biweekly, biweeklyName, biweeklyBps, timeZone, warnings);
        } catch (PmsAdapterException e) {
            throw new PropertyOnboardingException("mews_unreachable",
                    "Could not read your Mews setup. " + e.getMessage());
        }
    }

    /**
     * A display deposit, in basis points, must be a whole number from 0 to
     * 10000 (0% to 100%). Null means unset. It is only what the pop-up shows;
     * the rate's payment policy in Mews decides what is charged.
     */
    private static void checkDepositBps(Integer bps, String schedule) {
        if (bps != null && (bps < 0 || bps > 10000)) {
            throw new PropertyOnboardingException("invalid_deposit",
                    "The " + schedule + " deposit must be between 0% and 100%.");
        }
    }

    /** The rate's name, after checking it is a bookable rate on the service. Null id, null name. */
    private static String checkRate(List<MewsCatalog.Rate> rates, String rateId, String schedule,
            List<String> warnings) {
        if (rateId == null) return null;
        MewsCatalog.Rate rate = rates.stream().filter(r -> r.id().equals(rateId)).findFirst()
                .orElseThrow(() -> new PropertyOnboardingException("unknown_rate",
                        "The " + schedule + " rate is not on the chosen service."));
        if (!rate.bookable()) {
            throw new PropertyOnboardingException("rate_not_bookable",
                    "The " + schedule + " rate is disabled, inactive or tied to an availability block in Mews.");
        }
        if (!rate.isPublic()) {
            warnings.add(schedule + "_rate_is_private");
        }
        return rate.name();
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }

    private MewsConnection validatedConnection(Merchant merchant) {
        return connectionDao.findByMerchant(merchant.id())
                .filter(MewsConnection::isValidated)
                .orElseThrow(() -> new PropertyOnboardingException(
                        "mews_not_connected", "Connect Mews first."));
    }

    private static String firstNonBlank(String a, String b) {
        if (a != null && !a.isBlank()) return a;
        if (b != null && !b.isBlank()) return b;
        return null;
    }

    /**
     * Advances PMS_CONNECTED -> POLICY_SET when a property saves its plan rules.
     * No-op if the property has not connected a PMS yet or is already further
     * along.
     */
    public void markPolicySet(UUID merchantId) {
        Merchant merchant = reload(merchantId);
        if (merchant.onboardingState() == OnboardingState.PMS_CONNECTED) {
            advanceTo(merchant, OnboardingState.POLICY_SET);
        }
    }

    /**
     * Clears a property's stored Mews connection and reverts onboarding to
     * PMS_SELECTED (an explicit downgrade, unlike the forward-only steps). The
     * property keeps {@code pms_type=mews}, so the setup checklist points it
     * straight back at reconnecting. Idempotent.
     */
    public OnboardingStatus disconnectMews(Merchant merchant) {
        connectionDao.deleteByMerchant(merchant.id());
        if (merchant.onboardingState().isAtLeast(OnboardingState.PMS_CONNECTED)) {
            merchantDao.updateOnboardingState(merchant.id(), OnboardingState.PMS_SELECTED.wire());
        }
        log.info("Property {} disconnected Mews; reverted to pms_selected", merchant.id());
        return status(reload(merchant.id()));
    }

    /**
     * Finishes onboarding: POLICY_SET -> ACTIVE. Rejects activation before the
     * property has set its policies.
     */
    public OnboardingStatus activate(Merchant merchant) {
        OnboardingState state = merchant.onboardingState();
        if (state == OnboardingState.ACTIVE) {
            return status(merchant);
        }
        if (!state.isAtLeast(OnboardingState.POLICY_SET)) {
            throw new PropertyOnboardingException(
                    "setup_incomplete", "Finish the earlier setup steps before going live.");
        }
        merchantDao.updateOnboardingState(merchant.id(), OnboardingState.ACTIVE.wire());
        log.info("Property {} activated", merchant.id());
        return status(reload(merchant.id()));
    }

    /** Forward-only transition; never downgrades a property already further on. */
    private void advanceTo(Merchant merchant, OnboardingState target) {
        if (!merchant.onboardingState().isAtLeast(target)) {
            merchantDao.updateOnboardingState(merchant.id(), target.wire());
        }
    }

    private Merchant reload(UUID merchantId) {
        return merchantDao.findById(merchantId)
                .orElseThrow(() -> new IllegalStateException("merchant vanished: " + merchantId));
    }

    private static List<ChecklistItem> steps(OnboardingState state) {
        return List.of(
                new ChecklistItem("account", state.isAtLeast(OnboardingState.CREATED)),
                new ChecklistItem("pms_selected", state.isAtLeast(OnboardingState.PMS_SELECTED)),
                new ChecklistItem("pms_connected", state.isAtLeast(OnboardingState.PMS_CONNECTED)),
                new ChecklistItem("policy_set", state.isAtLeast(OnboardingState.POLICY_SET)),
                new ChecklistItem("active", state.isAtLeast(OnboardingState.ACTIVE)));
    }

    public record OnboardingStatus(
            String onboardingState,
            String pmsType,
            boolean complete,
            MewsInfo mews,
            StripeInfo stripe,
            CloudbedsInfo cloudbeds,
            List<ChecklistItem> steps) {
    }

    public record CloudbedsInfo(boolean connected, String propertyName, String currency) {
    }

    public record MewsInfo(
            boolean connected, String enterpriseName, String currency, boolean bookingSetupComplete) {
    }

    public record MewsSetupOptions(
            List<MewsCatalog.Service> services,
            String selectedServiceId,
            List<MewsCatalog.Rate> rates,
            String selectedMonthlyRateId,
            String selectedBiweeklyRateId,
            Integer monthlyDepositBps,
            Integer biweeklyDepositBps) {
    }

    /** {@code warnings} holds codes such as {@code monthly_rate_is_private}; empty when the setup is as Bliss asks. */
    public record MewsSetupResult(
            String serviceId,
            String monthlyRateId, String monthlyRateName, Integer monthlyDepositBps,
            String biweeklyRateId, String biweeklyRateName, Integer biweeklyDepositBps,
            String timeZone, List<String> warnings) {
    }

    public record StripeInfo(boolean connected, String connectStatus, String stripeAccountId) {
    }

    public record ChecklistItem(String key, boolean done) {
    }

    public record MewsConnectResult(String enterpriseName, String currency) {
    }
}
