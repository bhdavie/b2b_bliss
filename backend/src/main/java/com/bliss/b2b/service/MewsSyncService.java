package com.bliss.b2b.service;

import com.bliss.b2b.domain.BookingSource;
import com.bliss.b2b.domain.Merchant;
import com.bliss.b2b.integration.MewsApiClient;
import com.bliss.b2b.integration.MewsBookingDTO;
import com.bliss.b2b.payments.EligibilityResult;
import com.bliss.b2b.payments.MerchantPlanRules;
import com.bliss.b2b.payments.PlanEligibilityService;
import com.bliss.b2b.payments.PlanFrequency;
import com.bliss.b2b.payments.PlanOption;
import com.bliss.b2b.persistence.BookingDao;
import com.bliss.b2b.persistence.MerchantDao;
import com.bliss.b2b.persistence.MerchantPlanRulesDao;
import com.bliss.b2b.service.PlanCreationService.CreatePlanInput;
import java.time.Clock;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.jdbi.v3.core.Jdbi;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Pulls reservations from Mews and runs the eligible ones through the existing
 * Bliss booking → plan path. Demo-only (Mews is a v2-list integration).
 *
 * <p>Per reservation:
 * <ol>
 *   <li>Skip if already imported (a booking whose {@code booking_token} equals
 *       the Mews reservation id already exists) — makes re-running idempotent.
 *   <li>Run {@link PlanEligibilityService} with the arrival as the appointment
 *       date and a placeholder price. Only the eligible ones proceed.
 *   <li>Insert a {@code mews_import} booking (token = Mews id) and create a
 *       plan via {@link PlanCreationService#createPlan}, which re-validates
 *       eligibility and, with Stripe unconfigured, runs its demo branch.
 * </ol>
 *
 * <p>Guest name and price aren't on the Mews reservation, so they're filled
 * with {@link #PLACEHOLDER_GUEST_NAME} and {@link #PLACEHOLDER_TOTAL_CENTS}.
 */
public class MewsSyncService {

    private static final Logger log = LoggerFactory.getLogger(MewsSyncService.class);

    /** Mews reservations attach to this merchant for the demo. */
    static final String TARGET_MERCHANT_SLUG = "hawthorn-camden";

    /** Placeholder ticket price ($2,000) — Mews reservations carry no price here. */
    static final long PLACEHOLDER_TOTAL_CENTS = 200_000L;

    static final String PLACEHOLDER_GUEST_NAME = "Mews Guest";

    private final MewsApiClient mewsClient;
    private final Jdbi jdbi;
    private final PlanEligibilityService eligibilityService;
    private final PlanCreationService planCreationService;
    private final Clock clock;

    public MewsSyncService(
            MewsApiClient mewsClient,
            Jdbi jdbi,
            PlanEligibilityService eligibilityService,
            PlanCreationService planCreationService,
            Clock clock
    ) {
        this.mewsClient = mewsClient;
        this.jdbi = jdbi;
        this.eligibilityService = eligibilityService;
        this.planCreationService = planCreationService;
        this.clock = clock;
    }

    public SyncSummary sync() {
        List<MewsBookingDTO> reservations = mewsClient.fetchBookings();

        Merchant merchant = jdbi.withExtension(MerchantDao.class,
                        dao -> dao.findBySlug(TARGET_MERCHANT_SLUG))
                .orElseThrow(() -> new IllegalStateException(
                        "Mews target merchant not found: " + TARGET_MERCHANT_SLUG));
        MerchantPlanRules rules = jdbi.withExtension(MerchantPlanRulesDao.class,
                        dao -> dao.findByMerchantId(merchant.id()))
                .orElse(MerchantPlanRules.DEFAULTS);

        LocalDate today = LocalDate.now(clock);
        int eligible = 0;
        int ineligible = 0;
        int plansCreated = 0;
        int skipped = 0;

        for (MewsBookingDTO r : reservations) {
            if (r.id() == null || r.arrivalDate() == null) {
                skipped++;
                continue;
            }
            boolean alreadyImported = jdbi.withExtension(BookingDao.class,
                    dao -> dao.findByToken(r.id()).isPresent());
            if (alreadyImported) {
                skipped++;
                continue;
            }

            LocalDate arrival = OffsetDateTime.parse(r.arrivalDate()).toLocalDate();
            LocalDate departure = r.departureDate() != null
                    ? OffsetDateTime.parse(r.departureDate()).toLocalDate()
                    : null;

            EligibilityResult elig = eligibilityService.evaluate(
                    today, arrival, PLACEHOLDER_TOTAL_CENTS, rules);
            if (!elig.eligible()) {
                ineligible++;
                continue;
            }
            eligible++;

            // Insert the booking with the Mews id as its token, then run the
            // shared accept-a-plan path. Separate transactions: a booking whose
            // plan creation fails stays as a 'sent' row and is skipped on re-run.
            String email = syntheticEmail(r.id());
            jdbi.useExtension(BookingDao.class, dao -> dao.insert(
                    merchant.id(),
                    r.id(),
                    "Mews reservation",
                    "Imported from Mews (status " + r.status() + ")",
                    PLACEHOLDER_TOTAL_CENTS,
                    arrival,
                    departure,
                    null,
                    PLACEHOLDER_GUEST_NAME,
                    email,
                    null,
                    BookingSource.MEWS_IMPORT.wire()));

            PlanFrequency frequency = pickFrequency(elig, rules);
            try {
                planCreationService.createPlan(new CreatePlanInput(
                        TARGET_MERCHANT_SLUG,
                        r.id(),
                        email,
                        "Mews",
                        "Guest",
                        "pm_demo_mews_" + r.id(),
                        frequency,
                        null));
                plansCreated++;
            } catch (PlanCreationException e) {
                log.warn("Mews import: plan creation failed for reservation {}: {}",
                        r.id(), e.getMessage());
            }
        }

        SyncSummary summary = new SyncSummary(
                reservations.size(), eligible, ineligible, plansCreated, skipped);
        log.info("Mews sync: {}", summary);
        return summary;
    }

    private PlanFrequency pickFrequency(EligibilityResult elig, MerchantPlanRules rules) {
        PlanFrequency recommended = rules.resolveRecommended();
        if (recommended != null) {
            for (PlanOption o : elig.options()) {
                if (o.frequency() == recommended) {
                    return o.frequency();
                }
            }
        }
        return elig.options().get(0).frequency();
    }

    private static String syntheticEmail(String reservationId) {
        return "mews-" + reservationId + "@bliss-demo.invalid";
    }

    /**
     * Outcome of a sync run. {@code fetched} = reservations returned by Mews;
     * {@code eligible} = those that passed plan eligibility; {@code plansCreated}
     * = plans actually written; {@code ineligible} = failed the lead-time/amount
     * rules; {@code skipped} = already imported or missing required fields.
     */
    public record SyncSummary(
            int fetched,
            int eligible,
            int ineligible,
            int plansCreated,
            int skipped
    ) {}
}
