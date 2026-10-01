package com.bliss.b2b.service;

import com.bliss.b2b.domain.BlissRate;
import com.bliss.b2b.domain.Merchant;
import com.bliss.b2b.domain.MewsConnection;
import com.bliss.b2b.domain.PmsType;
import com.bliss.b2b.integration.EmailService;
import com.bliss.b2b.integration.EmailTemplates;
import com.bliss.b2b.payments.BookingType;
import com.bliss.b2b.payments.PlanFrequency;
import com.bliss.b2b.persistence.BlissRateDao;
import com.bliss.b2b.persistence.EmailLogDao;
import com.bliss.b2b.persistence.MerchantDao;
import com.bliss.b2b.persistence.MerchantMewsConnectionDao;
import com.bliss.b2b.service.BlissSettingsService.SettingsException;
import com.bliss.b2b.service.BlissSettingsService.SettingsView;
import java.util.List;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * "Switch Bliss on", the last setup screen (configurable-property spec,
 * section 10.1): turns Bliss on with its defaults, finishes onboarding, runs
 * the first sync with Mews, and sends the hotel "Bliss is on" once.
 */
public class BlissOnboardingService {

    private static final Logger log = LoggerFactory.getLogger(BlissOnboardingService.class);

    private final BlissSettingsService settings;
    private final PropertyOnboardingService onboarding;
    private final MewsSyncService sync;
    private final MerchantDao merchantDao;
    private final MerchantMewsConnectionDao mewsConnections;
    private final BlissRateDao rates;
    private final EmailLogDao emailLog;
    private final EmailService emailService;
    private final String merchantBaseUrl;

    public BlissOnboardingService(BlissSettingsService settings, PropertyOnboardingService onboarding,
            MewsSyncService sync, MerchantDao merchantDao, MerchantMewsConnectionDao mewsConnections,
            BlissRateDao rates, EmailLogDao emailLog, EmailService emailService, String merchantBaseUrl) {
        this.settings = settings;
        this.onboarding = onboarding;
        this.sync = sync;
        this.merchantDao = merchantDao;
        this.mewsConnections = mewsConnections;
        this.rates = rates;
        this.emailLog = emailLog;
        this.emailService = emailService;
        this.merchantBaseUrl = merchantBaseUrl;
    }

    /**
     * Switches Bliss on. A Mews property needs its connection and at least one
     * Bliss rate first. Safe to call twice: the email goes once.
     *
     * @throws SettingsException {@code mews_not_connected} or {@code no_bliss_rates}
     */
    public SettingsView switchOn(Merchant merchant) {
        if (merchant.pmsType() == PmsType.MEWS) {
            Optional<MewsConnection> conn = mewsConnections.findByMerchant(merchant.id());
            if (conn.isEmpty() || !conn.get().isValidated()) {
                throw new SettingsException("mews_not_connected", "Connect Mews first.");
            }
            if (!conn.get().isLinkingReady()) {
                throw new SettingsException("no_bliss_rates",
                        "Choose at least one Bliss rate so guests have a plan to book.");
            }
            // The first sync reads each rate's cancellation terms. A failure
            // here doesn't stop Bliss going on; the daily sync tries again.
            try {
                sync.sync(merchant.id());
            } catch (RuntimeException e) {
                log.warn("First Mews sync for merchant {} failed: {}", merchant.id(), e.toString());
            }
        }
        settings.enable(merchant);
        // Defaults stand in for the old plan rules step, so onboarding finishes here.
        onboarding.markPolicySet(merchant.id());
        Merchant fresh = merchantDao.findById(merchant.id()).orElse(merchant);
        onboarding.activate(fresh);
        fresh = merchantDao.findById(merchant.id()).orElse(fresh);

        SettingsView view = settings.view(fresh);
        if (fresh.email() != null && emailLog.claim("bliss_on:" + fresh.id(), "bliss_on", fresh.email()) == 1) {
            try {
                emailService.send(EmailTemplates.blissIsOn(fresh, rateLines(fresh), payoutLabel(view),
                        merchantBaseUrl + "/settings"));
            } catch (RuntimeException e) {
                log.warn("\"Bliss is on\" email to merchant {} not sent: {}", fresh.id(), e.toString());
            }
        }
        return view;
    }

    private List<EmailTemplates.RateLine> rateLines(Merchant merchant) {
        return rates.listForMerchant(merchant.id()).stream().filter(BlissRate::active).map(r -> {
            String schedule = r.frequency() == PlanFrequency.BIWEEKLY ? "paid every 2 weeks" : "paid monthly";
            String terms = r.syncedAt() == null ? null
                    : r.bookingType() == BookingType.NON_REFUNDABLE ? "Non-refundable" : r.terms().describe();
            return new EmailTemplates.RateLine(r.rateName() == null ? r.mewsRateId() : r.rateName().trim(),
                    schedule, terms);
        }).toList();
    }

    private static String payoutLabel(SettingsView view) {
        return view.settings().stream().filter(s -> "payoutMode".equals(s.key())).findFirst()
                .map(s -> String.valueOf(s.display()).toLowerCase(java.util.Locale.ROOT)
                        .equals("pay as you go")
                        ? "pay as you go, each payment goes straight to you as it's collected"
                        : "Bliss holds each payment until it can no longer be refunded, then sends it to you")
                .orElse("pay as you go");
    }
}
