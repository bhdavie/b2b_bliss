package com.bliss.b2b.service;

import com.bliss.b2b.domain.BlissRate;
import com.bliss.b2b.domain.BlissSettings;
import com.bliss.b2b.domain.Merchant;
import com.bliss.b2b.domain.MewsConnection;
import com.bliss.b2b.integration.EmailService;
import com.bliss.b2b.integration.EmailTemplates;
import com.bliss.b2b.integration.pms.MewsAdapter;
import com.bliss.b2b.integration.pms.MewsAdapterFactory;
import com.bliss.b2b.integration.pms.MewsCatalog;
import com.bliss.b2b.payments.BookingType;
import com.bliss.b2b.payments.CancellationTerms;
import com.bliss.b2b.payments.PlanFrequency;
import com.bliss.b2b.persistence.BlissRateDao;
import com.bliss.b2b.persistence.BlissSettingsDao;
import com.bliss.b2b.persistence.MerchantDao;
import com.bliss.b2b.persistence.MerchantMewsConnectionDao;
import com.bliss.b2b.persistence.MewsSyncRunDao;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import org.jdbi.v3.core.Jdbi;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Keeps Bliss in step with a property's setup in Mews (configurable-property
 * spec, section 5): each Bliss rate's name, whether it is still bookable, and
 * its rate group's cancellation policies, from which its booking type
 * (refundable or non-refundable) follows. Runs daily for every Mews property,
 * on demand from Settings, and before linking a reservation on a rate that has
 * never been synced.
 *
 * <p>The sync never changes a booking already made (each keeps the terms it
 * was made under) and never touches the hotel's booking type override. When
 * something material changes after the first sync, the hotel is emailed.
 */
public class MewsSyncService {

    private static final Logger log = LoggerFactory.getLogger(MewsSyncService.class);
    private static final ObjectMapper JSON = new ObjectMapper();

    private final Jdbi jdbi;
    private final MewsAdapterFactory mewsFactory;
    private final EmailService emailService;
    private final Clock clock;

    public MewsSyncService(Jdbi jdbi, MewsAdapterFactory mewsFactory, EmailService emailService, Clock clock) {
        this.jdbi = jdbi;
        this.mewsFactory = mewsFactory;
        this.emailService = emailService;
        this.clock = clock;
    }

    /** Syncs every Mews property that has a stay service. One failing property never stops the others. */
    public int syncAll() {
        List<UUID> merchants = jdbi.withHandle(h -> h.createQuery("""
                        SELECT merchant_id FROM merchant_mews_connections
                        WHERE validated_at IS NOT NULL AND service_id IS NOT NULL""")
                .mapTo(UUID.class).list());
        int synced = 0;
        for (UUID merchantId : merchants) {
            if (sync(merchantId).ok()) synced++;
        }
        return synced;
    }

    /**
     * Syncs one property's Bliss rates and fee line service from Mews and
     * records the run. Mews errors are recorded on the run, not thrown.
     */
    public Result sync(UUID merchantId) {
        MewsConnection conn = jdbi.withExtension(MerchantMewsConnectionDao.class,
                d -> d.findByMerchant(merchantId)).orElse(null);
        if (conn == null || !conn.isValidated() || conn.serviceId() == null) {
            return new Result(false, List.of(), "no Mews stay service connected");
        }
        Instant started = clock.instant();
        try {
            MewsAdapter adapter = mewsFactory.adapterForConnection(conn);
            // Pricing mode decides how folio amounts are sent (net or gross).
            String pricing = MewsAdapterFactory.pricingOf(adapter.getPropertyConfiguration());
            if (pricing != null && !pricing.equals(conn.pricing())) {
                jdbi.useExtension(MerchantMewsConnectionDao.class, d -> d.updatePricing(merchantId, pricing));
            }
            List<Change> changes = syncRates(merchantId, conn, adapter);
            changes.addAll(pickFeeService(merchantId, adapter));
            record(merchantId, started, changes, null);
            List<Change> material = changes.stream().filter(Change::material).toList();
            if (!material.isEmpty()) {
                notifyHotel(merchantId, material);
            }
            return new Result(true, changes, null);
        } catch (RuntimeException e) {
            log.warn("Mews sync failed for merchant {}: {}", merchantId, e.getMessage());
            record(merchantId, started, List.of(), truncate(e.getMessage()));
            return new Result(false, List.of(), e.getMessage());
        }
    }

    /**
     * The synced record for a Bliss rate, syncing first if it has never been
     * synced. Empty when the rate is not one of the property's Bliss rates.
     */
    public Optional<BlissRate> rateFor(UUID merchantId, String rateId) {
        Optional<BlissRate> rate = jdbi.withExtension(BlissRateDao.class, d -> d.find(merchantId, rateId));
        if (rate.isEmpty() || rate.get().syncedAt() == null) {
            sync(merchantId);
            rate = jdbi.withExtension(BlissRateDao.class, d -> d.find(merchantId, rateId));
        }
        return rate;
    }

    private List<Change> syncRates(UUID merchantId, MewsConnection conn, MewsAdapter adapter) {
        Map<String, PlanFrequency> blissRates = new LinkedHashMap<>();
        if (conn.blissMonthlyRateId() != null) blissRates.put(conn.blissMonthlyRateId(), PlanFrequency.MONTHLY);
        if (conn.blissBiweeklyRateId() != null) blissRates.put(conn.blissBiweeklyRateId(), PlanFrequency.BIWEEKLY);

        Map<String, BlissRate> previous = new LinkedHashMap<>();
        for (BlissRate r : jdbi.withExtension(BlissRateDao.class, d -> d.listForMerchant(merchantId))) {
            previous.put(r.mewsRateId(), r);
        }
        Map<String, MewsCatalog.Rate> rates = new LinkedHashMap<>();
        for (MewsCatalog.Rate r : adapter.getRates(conn.serviceId())) {
            rates.put(r.id(), r);
        }
        List<String> groups = blissRates.keySet().stream()
                .map(rates::get).filter(Objects::nonNull).map(MewsCatalog.Rate::groupId)
                .filter(Objects::nonNull).distinct().toList();
        Map<String, List<CancellationTerms.Step>> policies = adapter.getCancellationPolicies(conn.serviceId(), groups);

        Instant now = clock.instant();
        List<Change> changes = new ArrayList<>();
        for (Map.Entry<String, PlanFrequency> e : blissRates.entrySet()) {
            String rateId = e.getKey();
            MewsCatalog.Rate rate = rates.get(rateId);
            BlissRate before = previous.get(rateId);
            boolean active = rate != null && rate.active() && rate.enabled();
            String name = rate != null ? rate.name() : before != null ? before.rateName() : null;
            String group = rate != null ? rate.groupId() : before != null ? before.rateGroupId() : null;
            // A rate Mews no longer returns keeps its last known terms.
            CancellationTerms terms = rate != null
                    ? new CancellationTerms(policies.getOrDefault(group, List.of()))
                    : before != null ? before.terms() : CancellationTerms.freeUntilArrival();
            BookingType derived = terms.derivedType();

            if (before != null && before.syncedAt() != null) {
                String label = name == null ? rateId : name.trim();
                if (before.active() != active) {
                    changes.add(new Change(rateId, label, active ? "rate_available" : "rate_unavailable",
                            before.active() ? "bookable" : "not bookable", active ? "bookable" : "not bookable",
                            true));
                }
                if (!before.terms().equals(terms)) {
                    changes.add(new Change(rateId, label, "cancellation_terms",
                            before.terms().describe(), terms.describe(), true));
                }
                if (before.derivedType() != derived) {
                    changes.add(new Change(rateId, label, "booking_type",
                            before.derivedType().wire(), derived.wire(), before.override() == null));
                }
                if (!Objects.equals(trim(before.rateName()), trim(name))) {
                    changes.add(new Change(rateId, label, "rate_renamed", trim(before.rateName()), trim(name),
                            false));
                }
            }
            jdbi.useExtension(BlissRateDao.class, d -> d.upsertSynced(merchantId, rateId, e.getValue().wire(),
                    name, group, active, BlissRateDao.termsJson(terms), derived.wire(), now));
        }
        String[] keep = blissRates.keySet().toArray(new String[0]);
        jdbi.useExtension(BlissRateDao.class, d -> d.deleteOthers(merchantId, keep));
        return changes;
    }

    /**
     * Mews only takes the fee line on an additional service. If the property
     * has not chosen one, pick an active service named like "Bliss", the name
     * hotels are asked to give it. Never replaces a choice already made.
     */
    private List<Change> pickFeeService(UUID merchantId, MewsAdapter adapter) {
        BlissSettings settings = jdbi.withExtension(BlissSettingsDao.class, d -> d.find(merchantId))
                .orElse(BlissSettings.defaults(merchantId));
        if (settings.feeServiceId() != null) {
            return List.of();
        }
        Optional<MewsCatalog.AdditionalService> bliss = adapter.getAdditionalServices().stream()
                .filter(MewsCatalog.AdditionalService::active)
                .filter(s -> s.name() != null && s.name().toLowerCase(Locale.ROOT).contains("bliss"))
                .findFirst();
        if (bliss.isEmpty()) {
            return List.of();
        }
        jdbi.useExtension(BlissSettingsDao.class, d -> {
            d.insertDefaults(merchantId);
            d.updateFeeLine(merchantId, bliss.get().id(), settings.feeTaxCode(), settings.feeAccountingCategoryId());
        });
        return List.of(new Change(null, bliss.get().name(), "fee_service_selected", null, bliss.get().id(), false));
    }

    private void notifyHotel(UUID merchantId, List<Change> changes) {
        try {
            Merchant merchant = jdbi.withExtension(MerchantDao.class, d -> d.findById(merchantId)).orElse(null);
            if (merchant != null && merchant.email() != null) {
                emailService.send(EmailTemplates.mewsSetupChanged(
                        merchant, changes.stream().map(MewsSyncService::describe).toList()));
            }
        } catch (RuntimeException e) {
            log.warn("Could not email merchant {} about Mews changes: {}", merchantId, e.getMessage());
        }
    }

    /** A change in a sentence the hotel reads. */
    static String describe(Change c) {
        String rate = "Your Bliss rate \"" + c.rateName() + "\"";
        return switch (c.kind()) {
            case "rate_unavailable" -> rate + " can no longer be booked in Mews. Bliss won't link new bookings on "
                    + "it, and existing plans carry on as they are.";
            case "rate_available" -> rate + " can be booked in Mews again, so Bliss links new bookings on it.";
            case "cancellation_terms" -> rate + " has new cancellation terms in Mews: " + c.after()
                    + " (it was: " + c.before() + "). New bookings follow them; existing bookings keep theirs.";
            case "booking_type" -> rate + " is now " + ("non_refundable".equals(c.after())
                    ? "non-refundable" : "refundable") + " in Mews. New bookings follow it; existing bookings "
                    + "keep their terms.";
            default -> rate + " changed in Mews.";
        };
    }

    private void record(UUID merchantId, Instant started, List<Change> changes, String error) {
        String json;
        try {
            json = JSON.writeValueAsString(changes);
        } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
            json = "[]";
        }
        String changesJson = json;
        jdbi.useExtension(MewsSyncRunDao.class,
                d -> d.record(merchantId, started, clock.instant(), changesJson, error));
    }

    private static String trim(String s) {
        return s == null ? null : s.trim();
    }

    private static String truncate(String s) {
        return s == null ? null : s.length() > 500 ? s.substring(0, 500) : s;
    }

    /** One sync's outcome. */
    public record Result(boolean ok, List<Change> changes, String error) {
    }

    /**
     * Something the sync found different from last time. {@code material}
     * changes are emailed to the hotel: a rate becoming unbookable or bookable
     * again, new cancellation terms, or a new booking type that the hotel has
     * not overridden.
     */
    public record Change(String rateId, String rateName, String kind, String before, String after,
            boolean material) {
    }
}
