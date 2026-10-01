package com.bliss.b2b.service;

import com.bliss.b2b.BlissConfiguration.FeaturesConfig;
import com.bliss.b2b.domain.BlissSettings;
import com.bliss.b2b.domain.MewsConnection;
import com.bliss.b2b.integration.pms.MewsAdapter;
import com.bliss.b2b.integration.pms.MewsAdapterFactory;
import com.bliss.b2b.persistence.BlissSettingsDao;
import com.bliss.b2b.persistence.FolioPostingDao;
import com.bliss.b2b.persistence.FolioPostingDao.Posting;
import com.bliss.b2b.persistence.MerchantMewsConnectionDao;
import java.time.Clock;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.jdbi.v3.core.Jdbi;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Posts the Bliss fee to a Mews reservation's folio as its own line, "Bliss
 * service fee", alongside other fees and not in taxes (configurable-property
 * spec, section 6). With the line on the folio, the folio total matches what
 * the guest pays in total, instead of the installments overpaying the bill by
 * the fee.
 *
 * <p>Once per plan: the posting is claimed under a key of the plan before
 * Mews is called, so a retry never posts a second line. A posting Mews did
 * not take (no fee service chosen yet, or a Mews error) stays pending and is
 * retried on the next link pass.
 */
public class FeeLineService {

    private static final Logger log = LoggerFactory.getLogger(FeeLineService.class);
    static final String LINE_NAME = "Bliss service fee";
    /** Slack around a posting's lifetime when searching Mews for an earlier attempt. */
    private static final java.time.Duration SEARCH_MARGIN = java.time.Duration.ofHours(1);

    private final Jdbi jdbi;
    private final MewsAdapterFactory mewsFactory;
    private final FeaturesConfig features;
    private final Clock clock;

    public FeeLineService(Jdbi jdbi, MewsAdapterFactory mewsFactory, FeaturesConfig features, Clock clock) {
        this.jdbi = jdbi;
        this.mewsFactory = mewsFactory;
        this.features = features;
        this.clock = clock;
    }

    static String keyFor(UUID planId) {
        return "fee_line:" + planId;
    }

    /** Claims and posts the fee line for a newly linked Mews plan. Never throws. */
    public void postForPlan(UUID merchantId, UUID bookingId, UUID planId, long feeMinor, String currency) {
        if (!features.isFeeFolioLine() || feeMinor <= 0) {
            return;
        }
        String key = keyFor(planId);
        jdbi.useExtension(FolioPostingDao.class, d -> d.claim(bookingId, "fee_line", key, feeMinor, currency));
        jdbi.withExtension(FolioPostingDao.class, d -> d.find(key))
                .filter(p -> "pending".equals(p.status()))
                .ifPresent(p -> attempt(merchantId, p));
    }

    /** Retries a property's pending fee lines. Returns how many posted. */
    public int retryPending(UUID merchantId) {
        if (!features.isFeeFolioLine()) {
            return 0;
        }
        int posted = 0;
        for (Posting p : jdbi.withExtension(FolioPostingDao.class, d -> d.pendingForMerchant(merchantId))) {
            if (attempt(merchantId, p)) posted++;
        }
        return posted;
    }

    private boolean attempt(UUID merchantId, Posting posting) {
        try {
            BlissSettings settings = jdbi.withExtension(BlissSettingsDao.class, d -> d.find(merchantId))
                    .orElse(BlissSettings.defaults(merchantId));
            if (settings.feeServiceId() == null) {
                // Mews only takes orders on an additional service. Until the
                // hotel has one (Settings shows this), the line waits.
                return false;
            }
            Map<String, Object> target = jdbi.withHandle(h -> h.createQuery("""
                            SELECT b.mews_reservation_id AS reservation, c.mews_customer_id AS customer
                            FROM bookings b
                            JOIN payment_plans pp ON pp.booking_id = b.id
                            JOIN customers c ON c.id = pp.customer_id
                            WHERE b.id = :bookingId
                            ORDER BY pp.created_at DESC LIMIT 1""")
                    .bind("bookingId", posting.bookingId()).mapToMap().findOne().orElse(Map.of()));
            String reservationId = (String) target.get("reservation");
            String customerId = (String) target.get("customer");
            if (reservationId == null || customerId == null) {
                jdbi.useExtension(FolioPostingDao.class,
                        d -> d.recordFailure(posting.id(), "booking has no Mews reservation or guest"));
                return false;
            }
            MewsConnection conn = jdbi.withExtension(MerchantMewsConnectionDao.class,
                    d -> d.findByMerchant(merchantId)).orElseThrow();
            MewsAdapter adapter = mewsFactory.adapterForConnection(conn);

            // Never twice: if Mews already has this line (an earlier attempt
            // posted it but Bliss never recorded the reply), record that one.
            Instant now = clock.instant();
            Optional<String> existing = adapter.findOrderByExternalIdentifier(settings.feeServiceId(),
                    posting.createdAt().minus(SEARCH_MARGIN), now.plus(SEARCH_MARGIN), posting.idempotencyKey());
            if (existing.isPresent()) {
                jdbi.useExtension(FolioPostingDao.class, d -> d.markPosted(posting.id(), existing.get(), now));
                log.info("Bliss fee line {} was already on the folio (order {}); recorded it, posted nothing",
                        posting.idempotencyKey(), existing.get());
                return true;
            }

            boolean net = netPricing(merchantId, conn, adapter);
            String orderId = adapter.addOrderItem(settings.feeServiceId(), customerId, reservationId, LINE_NAME,
                    posting.amountMinor(), posting.currency(), settings.feeTaxCode(),
                    settings.feeAccountingCategoryId(), posting.idempotencyKey(), "Bliss payment plan fee", net);
            jdbi.useExtension(FolioPostingDao.class, d -> d.markPosted(posting.id(), orderId, clock.instant()));
            log.info("Posted Bliss fee line {} {} to Mews reservation {} (order {})",
                    posting.amountMinor(), posting.currency(), reservationId, orderId);
            return true;
        } catch (RuntimeException e) {
            log.warn("Bliss fee line {} not posted yet: {}", posting.idempotencyKey(), e.getMessage());
            jdbi.useExtension(FolioPostingDao.class, d -> d.recordFailure(posting.id(), truncate(e.getMessage())));
            return false;
        }
    }

    /**
     * The property's pricing mode: stored on the connection, or read from
     * Mews and stored the first time it is needed. A property Mews reports
     * neither for is treated as gross, as Bliss posted before V40.
     */
    private boolean netPricing(UUID merchantId, MewsConnection conn, MewsAdapter adapter) {
        if (conn.pricing() != null) {
            return conn.netPricing();
        }
        String pricing = MewsAdapterFactory.pricingOf(adapter.getPropertyConfiguration());
        if (pricing != null) {
            jdbi.useExtension(MerchantMewsConnectionDao.class, d -> d.updatePricing(merchantId, pricing));
        }
        return "Net".equals(pricing);
    }

    private static String truncate(String s) {
        return s == null ? null : s.length() > 500 ? s.substring(0, 500) : s;
    }
}
