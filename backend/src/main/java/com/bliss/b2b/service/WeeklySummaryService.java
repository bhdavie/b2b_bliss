package com.bliss.b2b.service;

import com.bliss.b2b.domain.Merchant;
import com.bliss.b2b.integration.EmailService;
import com.bliss.b2b.integration.EmailTemplates;
import com.bliss.b2b.persistence.EmailLogDao;
import com.bliss.b2b.persistence.MerchantDao;
import java.time.Clock;
import java.time.DayOfWeek;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.jdbi.v3.core.Jdbi;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * The hotel's Monday summary (configurable-property spec, section 10.2): new
 * plans, payments collected, money coming to it this week (hold mode) and
 * bookings that need a look, over the last seven days. Checked hourly; sent
 * once per property per Monday in the property's own time zone, and only when
 * there is something to say.
 */
public class WeeklySummaryService {

    private static final Logger log = LoggerFactory.getLogger(WeeklySummaryService.class);
    private static final Duration WEEK = Duration.ofDays(7);

    private final Jdbi jdbi;
    private final EmailService emailService;
    private final String merchantBaseUrl;
    private final Clock clock;

    public WeeklySummaryService(Jdbi jdbi, EmailService emailService, String merchantBaseUrl, Clock clock) {
        this.jdbi = jdbi;
        this.emailService = emailService;
        this.merchantBaseUrl = merchantBaseUrl;
        this.clock = clock;
    }

    /** Sends the summaries due now. Returns how many were sent. */
    public int runIfDue() {
        Instant now = clock.instant();
        List<UUID> enabled = jdbi.withHandle(h -> h.createQuery(
                        "SELECT merchant_id FROM property_bliss_settings "
                                + "WHERE bliss_enabled_at IS NOT NULL AND weekly_summary")
                .mapTo(UUID.class).list());
        int sent = 0;
        for (UUID id : enabled) {
            try {
                if (sendIfDue(id, now)) sent++;
            } catch (RuntimeException e) {
                log.warn("Weekly summary for merchant {} failed: {}", id, e.toString());
            }
        }
        return sent;
    }

    boolean sendIfDue(UUID merchantId, Instant now) {
        Merchant merchant = jdbi.withExtension(MerchantDao.class, d -> d.findById(merchantId)).orElse(null);
        if (merchant == null || merchant.email() == null) return false;
        LocalDate today = now.atZone(zone(merchant.timeZone())).toLocalDate();
        if (today.getDayOfWeek() != DayOfWeek.MONDAY) return false;

        EmailTemplates.WeeklySummary w = summarise(merchantId, now);
        boolean quiet = w.newPlans() == 0 && w.collected().isEmpty() && w.releasingSoon().isEmpty()
                && w.openFlags() == 0;
        if (quiet) return false;
        if (jdbi.withExtension(EmailLogDao.class,
                d -> d.claim("weekly:" + merchantId + ":" + today, "weekly_summary", merchant.email())) != 1) {
            return false;
        }
        emailService.send(EmailTemplates.weeklySummary(merchant, w, merchantBaseUrl + "/home"));
        return true;
    }

    EmailTemplates.WeeklySummary summarise(UUID merchantId, Instant now) {
        Instant since = now.minus(WEEK);
        return jdbi.withHandle(h -> {
            int plans = h.createQuery("""
                            SELECT count(*) FROM payment_plans pp JOIN bookings b ON b.id = pp.booking_id
                            WHERE b.merchant_id = :m AND pp.created_at >= :since""")
                    .bind("m", merchantId).bind("since", since).mapTo(Integer.class).one();
            Map<String, Long> collected = sums(h.createQuery("""
                            SELECT b.currency AS currency, sum(ps.amount_cents) AS total
                            FROM payment_schedule ps
                            JOIN payment_plans pp ON pp.id = ps.payment_plan_id
                            JOIN bookings b ON b.id = pp.booking_id
                            WHERE b.merchant_id = :m AND ps.status = 'paid' AND ps.paid_at >= :since
                              AND b.currency IS NOT NULL
                            GROUP BY b.currency ORDER BY b.currency""")
                    .bind("m", merchantId).bind("since", since).mapToMap().list());
            Map<String, Long> releasing = sums(h.createQuery("""
                            SELECT r.currency AS currency, sum(r.amount_minor) AS total
                            FROM payout_releases r JOIN bookings b ON b.id = r.booking_id
                            WHERE b.merchant_id = :m AND r.status = 'scheduled' AND r.step <> 'fee_debit'
                              AND r.release_at < :until
                            GROUP BY r.currency ORDER BY r.currency""")
                    .bind("m", merchantId).bind("until", now.plus(WEEK)).mapToMap().list());
            int flags = h.createQuery(
                            "SELECT count(*) FROM mews_flags WHERE merchant_id = :m AND resolved_at IS NULL")
                    .bind("m", merchantId).mapTo(Integer.class).one();
            return new EmailTemplates.WeeklySummary(plans, collected, releasing, flags);
        });
    }

    private static Map<String, Long> sums(List<Map<String, Object>> rows) {
        Map<String, Long> out = new LinkedHashMap<>();
        for (Map<String, Object> r : rows) {
            Number total = (Number) r.get("total");
            if (total != null && total.longValue() > 0) {
                out.put((String) r.get("currency"), total.longValue());
            }
        }
        return out;
    }

    private static ZoneId zone(String timeZone) {
        try {
            return timeZone == null ? ZoneOffset.UTC : ZoneId.of(timeZone);
        } catch (RuntimeException e) {
            return ZoneOffset.UTC;
        }
    }
}
