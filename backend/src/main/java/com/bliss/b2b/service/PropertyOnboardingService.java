package com.bliss.b2b.service;

import com.bliss.b2b.BlissConfiguration.PmsConfig.MewsPmsConfig;
import com.bliss.b2b.domain.Merchant;
import com.bliss.b2b.domain.MewsConnection;
import com.bliss.b2b.domain.OnboardingState;
import com.bliss.b2b.domain.PmsType;
import com.bliss.b2b.domain.StripeConnection;
import com.bliss.b2b.integration.pms.MewsAdapter;
import com.bliss.b2b.integration.pms.MewsAdapterFactory;
import com.bliss.b2b.integration.pms.PmsAdapterException;
import com.bliss.b2b.integration.pms.PmsPropertyConfiguration;
import com.bliss.b2b.persistence.MerchantDao;
import com.bliss.b2b.persistence.MerchantMewsConnectionDao;
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

    /** Mews demo platform url, reused when a property leaves the field blank. */
    private static final String DEFAULT_PLATFORM_URL = new MewsPmsConfig().getPlatformUrl();

    private final MerchantDao merchantDao;
    private final MerchantMewsConnectionDao connectionDao;
    private final MerchantStripeConnectionDao stripeConnectionDao;
    private final MewsAdapterFactory mewsFactory;
    private final Clock clock;

    public PropertyOnboardingService(
            MerchantDao merchantDao,
            MerchantMewsConnectionDao connectionDao,
            MerchantStripeConnectionDao stripeConnectionDao,
            MewsAdapterFactory mewsFactory,
            Clock clock) {
        this.merchantDao = merchantDao;
        this.connectionDao = connectionDao;
        this.stripeConnectionDao = stripeConnectionDao;
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
                    conn == null ? null : conn.currency());
        }
        StripeInfo stripe = null;
        if (merchant.pmsType() == PmsType.STRIPE) {
            StripeConnection conn = stripeConnectionDao.findByMerchant(merchant.id()).orElse(null);
            stripe = new StripeInfo(
                    conn != null && conn.isChargesEnabled(),
                    conn == null ? null : conn.connectStatus(),
                    conn == null ? null : conn.stripeAccountId());
        }
        return new OnboardingStatus(
                state.wire(),
                merchant.pmsType().wire(),
                state == OnboardingState.ACTIVE,
                mews,
                stripe,
                steps(state));
    }

    /**
     * Advances a Stripe-rail property PMS_SELECTED -> PMS_CONNECTED once its
     * Standard connection can take charges. This is the Stripe equivalent of the
     * Mews "connect" step: a Stripe-rail property routes through Connect before
     * it can set policies. No-op if the property is not on the Stripe rail, has
     * no charges-enabled connection, or is already further along. Idempotent.
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
        String effectiveUrl = (platformUrl == null || platformUrl.isBlank())
                ? DEFAULT_PLATFORM_URL : platformUrl.trim();

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

        connectionDao.upsertValidated(
                merchant.id(), effectiveUrl, clientToken.trim(), accessToken.trim(),
                cfg.enterpriseId(), cfg.name(), cfg.defaultCurrency(), Instant.now(clock));
        merchantDao.updatePmsType(merchant.id(), PmsType.MEWS.wire());
        advanceTo(merchant, OnboardingState.PMS_CONNECTED);
        log.info("Property {} connected Mews enterprise '{}' ({})",
                merchant.id(), cfg.name(), cfg.defaultCurrency());
        return new MewsConnectResult(cfg.name(), cfg.defaultCurrency());
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
            List<ChecklistItem> steps) {
    }

    public record MewsInfo(boolean connected, String enterpriseName, String currency) {
    }

    public record StripeInfo(boolean connected, String connectStatus, String stripeAccountId) {
    }

    public record ChecklistItem(String key, boolean done) {
    }

    public record MewsConnectResult(String enterpriseName, String currency) {
    }
}
