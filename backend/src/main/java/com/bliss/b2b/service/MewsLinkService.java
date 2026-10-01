package com.bliss.b2b.service;

import com.bliss.b2b.domain.Merchant;
import com.bliss.b2b.domain.MewsConnection;
import com.bliss.b2b.integration.EmailService;
import com.bliss.b2b.integration.EmailTemplates;
import com.bliss.b2b.integration.pms.MewsAdapter;
import com.bliss.b2b.integration.pms.MewsAdapter.MewsCardPayment;
import com.bliss.b2b.integration.pms.MewsAdapter.MewsReservation;
import com.bliss.b2b.integration.pms.MewsAdapterFactory;
import com.bliss.b2b.integration.pms.PmsAdapterException;
import com.bliss.b2b.integration.pms.PmsCustomer;
import com.bliss.b2b.integration.pms.PmsStoredCard;
import com.bliss.b2b.payments.PlanFrequency;
import com.bliss.b2b.persistence.MerchantDao;
import com.bliss.b2b.persistence.MerchantMewsConnectionDao;
import com.bliss.b2b.persistence.MewsLinkingDao;
import com.bliss.b2b.persistence.MewsLinkingDao.LinkRow;
import com.bliss.b2b.persistence.MewsLinkingDao.LinkedBooking;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.jdbi.v3.core.Jdbi;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Finds the reservations guests make on a property's Bliss rates in its own
 * Mews booking engine, and builds each one's plan.
 *
 * <p>The guest chooses a plan in the Bliss pop-up, then books the matching
 * Bliss rate in Mews as normal. Mews takes the card and whatever the rate
 * charges upfront. Every two minutes this pass, per property:
 * <ol>
 *   <li>reads the reservations Mews updated since the last pass (with a small
 *       overlap), and records each one on a Bliss rate that has no plan yet;
 *   <li>checks reservations that already have a plan for a cancellation or a
 *       change of dates in Mews, and flags either to the property;
 *   <li>tries to link every recorded reservation: once Mews has it confirmed
 *       and the upfront charge has settled, the charge names the card, the
 *       order items give the total, and the plan is built for the remainder.
 * </ol>
 *
 * <p>The rate tells Bliss the schedule; nothing depends on the guest's
 * browser reporting back. Bliss never re-plans on its own: anything it cannot
 * settle (dates moved, cancelled in Mews, no upfront charge, not eligible) is
 * a flag the property is emailed about once.
 */
public class MewsLinkService {

    private static final Logger log = LoggerFactory.getLogger(MewsLinkService.class);

    /** Re-read this much before the mark each pass, so a slow Mews write is not missed. */
    static final Duration POLL_OVERLAP = Duration.ofMinutes(5);
    /** A property's first pass looks back this far. */
    static final Duration FIRST_LOOKBACK = Duration.ofDays(1);
    /** Mews allows three months per UpdatedUtc filter; stay well inside it after an outage. */
    static final Duration MAX_WINDOW = Duration.ofDays(80);
    /**
     * How long a confirmed reservation may go without a settled upfront charge
     * before it is flagged. The booking engine charges during checkout, so a
     * confirmed reservation normally has one by the first pass that sees it.
     */
    static final Duration UPFRONT_CHARGE_GRACE = Duration.ofMinutes(30);
    /** Pending reservations read per reservations/getAll call. */
    static final int PENDING_BATCH = 100;

    /** Reservation states that mean the guest has booked. */
    static final Set<String> BOOKED_STATES = Set.of("Confirmed", "Started", "Processed");

    static final String FLAG_DATES_CHANGED = "dates_changed";
    static final String FLAG_CANCELED_IN_MEWS = "canceled_in_mews";
    static final String FLAG_NO_UPFRONT_CHARGE = "no_upfront_charge";
    static final String FLAG_NOT_ELIGIBLE = "not_eligible";
    static final String FLAG_LINK_FAILED = "link_failed";
    static final String FLAG_HOLD_CARD_NEEDED = "hold_card_needed";

    private static final DateTimeFormatter SHORT_DATE =
            DateTimeFormatter.ofPattern("EEE d MMM yyyy", Locale.ENGLISH);

    private final Jdbi jdbi;
    private final MewsAdapterFactory mewsFactory;
    private final PlanCreationService planCreationService;
    private final EmailService emailService;
    private final Clock clock;
    /** Rate terms from Mews; null skips the booking snapshot (older tests). */
    private final MewsSyncService syncService;
    /** Posts the Bliss fee line; null skips it. */
    private final FeeLineService feeLines;
    /** Feature flags; the default has every flag at its configured default. */
    private com.bliss.b2b.BlissConfiguration.FeaturesConfig features =
            new com.bliss.b2b.BlissConfiguration.FeaturesConfig();
    /** Hold mode card path A (D1). */
    private MewsCardForwarder cardForwarder = MewsCardForwarder.NOT_AVAILABLE;

    /**
     * Hold mode, D1 option A: moves the card Mews holds for a reservation into
     * Stripe, vault to vault through Mews's PCI tokenization, and returns the
     * Stripe PaymentMethod id. Not built: it needs Mews to grant our
     * integration card access and Stripe to accept the forwarded card.
     */
    public interface MewsCardForwarder {
        String forward(UUID merchantId, String reservationId, String mewsCreditCardId);

        MewsCardForwarder NOT_AVAILABLE = (merchantId, reservationId, cardId) -> {
            // TODO(D1): Mews card access (PCI Proxy) and Stripe's acceptance of
            // the forwarded card are both unanswered; option C is the fallback.
            throw new UnsupportedOperationException("forwarding the Mews card to Stripe isn't available yet (D1)");
        };
    }

    public MewsLinkService withFeatures(com.bliss.b2b.BlissConfiguration.FeaturesConfig features,
            MewsCardForwarder cardForwarder) {
        this.features = features;
        this.cardForwarder = cardForwarder == null ? MewsCardForwarder.NOT_AVAILABLE : cardForwarder;
        return this;
    }

    public MewsLinkService(Jdbi jdbi, MewsAdapterFactory mewsFactory,
            PlanCreationService planCreationService, EmailService emailService, Clock clock) {
        this(jdbi, mewsFactory, planCreationService, emailService, clock, null, null);
    }

    public MewsLinkService(Jdbi jdbi, MewsAdapterFactory mewsFactory,
            PlanCreationService planCreationService, EmailService emailService, Clock clock,
            MewsSyncService syncService, FeeLineService feeLines) {
        this.jdbi = jdbi;
        this.mewsFactory = mewsFactory;
        this.planCreationService = planCreationService;
        this.emailService = emailService;
        this.clock = clock;
        this.syncService = syncService;
        this.feeLines = feeLines;
    }

    /** One pass over every property with Bliss rates. A failing property never stops the others. */
    public PassResult runLinkPass() {
        List<UUID> merchants = jdbi.withExtension(MewsLinkingDao.class, MewsLinkingDao::findLinkingMerchants);
        PassResult total = PassResult.EMPTY;
        for (UUID merchantId : merchants) {
            try {
                total = total.plus(runForMerchant(merchantId));
            } catch (RuntimeException e) {
                log.error("Mews link pass failed for merchant {}: {}", merchantId, e.getMessage(), e);
                total = total.plus(new PassResult(0, 0, 0, 1));
            }
        }
        if (total.seen() > 0 || total.linked() > 0 || total.flagged() > 0 || total.failedProperties() > 0) {
            log.info("Mews link pass: {} Bliss reservations seen, {} linked, {} flagged, {} properties failed",
                    total.seen(), total.linked(), total.flagged(), total.failedProperties());
        }
        return total;
    }

    PassResult runForMerchant(UUID merchantId) {
        MewsConnection conn = jdbi.withExtension(MerchantMewsConnectionDao.class,
                d -> d.findByMerchant(merchantId)).orElse(null);
        if (conn == null || !conn.isLinkingReady()) {
            return PassResult.EMPTY;
        }
        // Without its currency and zone a property's reservations cannot be
        // priced or dated, and guessing either would build a wrong plan. Skip
        // it until onboarding records them; nothing is marked as seen, so the
        // reservations are picked up once it does.
        if (conn.currency() == null || conn.currency().isBlank()) {
            log.warn("Mews property {} has no currency; not linking reservations", merchantId);
            return PassResult.EMPTY;
        }
        ZoneId zone = zoneOf(conn);
        if (zone == null) {
            log.warn("Mews property {} has no valid time zone ({}); not linking reservations",
                    merchantId, conn.timeZone());
            return PassResult.EMPTY;
        }
        MewsAdapter adapter = mewsFactory.adapterForConnection(conn);
        if (feeLines != null) {
            feeLines.retryPending(merchantId);
        }

        Instant now = clock.instant();
        Instant mark = conn.linkedThroughUtc() != null ? conn.linkedThroughUtc() : now.minus(FIRST_LOOKBACK);
        Instant from = mark.minus(POLL_OVERLAP);
        if (from.isBefore(now.minus(MAX_WINDOW))) {
            log.warn("Mews link mark for merchant {} is {}; reading only the last {} days",
                    merchantId, mark, MAX_WINDOW.toDays());
            from = now.minus(MAX_WINDOW);
        }

        int seen = 0;
        int flagged = 0;
        int skippedGuests = 0;
        // Throws on Mews errors: the mark is not advanced, so the next pass re-reads.
        List<MewsReservation> updated = adapter.getReservationsUpdated(conn.serviceId(), from, now);
        for (MewsReservation r : updated) {
            Optional<LinkedBooking> linked = jdbi.withExtension(MewsLinkingDao.class,
                    d -> d.findLinkedBooking(merchantId, r.id()));
            if (linked.isPresent()) {
                flagged += checkLinked(merchantId, r, linked.get(), zone);
            } else if (conn.frequencyForRate(r.rateId()) != null) {
                // A connection with a guest allowlist (a demo property on a
                // shared Mews sandbox) ignores everyone else's reservations
                // here, before any link row exists, so they can never become
                // plans or be charged.
                if (conn.hasGuestAllowlist() && !allowlisted(conn, adapter, r)) {
                    skippedGuests++;
                    continue;
                }
                seen++;
                jdbi.useExtension(MewsLinkingDao.class, d -> d.insertPendingLink(merchantId, r.id(), now));
            }
        }
        jdbi.useExtension(MewsLinkingDao.class, d -> d.advanceLinkedThrough(merchantId, now));
        if (skippedGuests > 0) {
            log.info("Mews link pass for merchant {} ignored {} Bliss-rate reservations from guests "
                    + "not on its allowlist", merchantId, skippedGuests);
        }

        int linkedCount = 0;
        List<LinkRow> pending = jdbi.withExtension(MewsLinkingDao.class, d -> d.findPendingLinks(merchantId));
        if (pending.isEmpty()) {
            return new PassResult(seen, 0, flagged, 0);
        }
        // One read for every pending reservation, not one each: the Connector
        // API rate-limits per token, and a busy property can have several.
        java.util.Map<String, MewsReservation> current = new java.util.HashMap<>();
        for (int i = 0; i < pending.size(); i += PENDING_BATCH) {
            List<String> ids = pending.subList(i, Math.min(i + PENDING_BATCH, pending.size())).stream()
                    .map(LinkRow::reservationId).toList();
            for (MewsReservation r : adapter.getReservations(ids)) {
                current.put(r.id(), r);
            }
        }
        for (LinkRow link : pending) {
            Attempt a = attemptLink(conn, adapter, zone, link, current.get(link.reservationId()));
            if (a == Attempt.LINKED) linkedCount++;
            if (a == Attempt.FLAGGED) flagged++;
            if (a == Attempt.RATE_LIMITED) {
                // Every further call would be refused too. The rest wait for the next pass.
                log.warn("Mews rate-limited the link pass for merchant {}; resuming next pass", merchantId);
                break;
            }
        }
        return new PassResult(seen, linkedCount, flagged, 0);
    }

    /**
     * Whether a reservation's guest is on the connection's allowlist. Reads
     * the guest from Mews; if Mews cannot say, the answer is no, so an
     * unreadable guest is never linked on an allowlisted connection.
     */
    private boolean allowlisted(MewsConnection conn, MewsAdapter adapter, MewsReservation r) {
        if (r.accountId() == null) {
            return false;
        }
        try {
            return adapter.getCustomer(r.accountId())
                    .map(g -> conn.allowsGuest(g.email()))
                    .orElse(false);
        } catch (RuntimeException e) {
            log.warn("Could not read the guest of reservation {} for the allowlist: {}; ignoring it",
                    r.id(), e.getMessage());
            return false;
        }
    }

    // --- Reservations that already have a plan ---------------------------------

    private int checkLinked(UUID merchantId, MewsReservation r, LinkedBooking booking, ZoneId zone) {
        if ("Canceled".equals(r.state())) {
            // A cancel made through Bliss marks the booking canceled first;
            // only a cancel made in Mews reaches here with a live booking.
            if ("canceled".equals(booking.bookingStatus())) {
                return 0;
            }
            return flag(merchantId, r, booking.bookingId(), FLAG_CANCELED_IN_MEWS,
                    "A Bliss booking was cancelled in Mews.",
                    "The guest's plan is still active in Bliss. Remaining payments will not be taken "
                            + "while the reservation is cancelled.") ? 1 : 0;
        }
        boolean moved = booking.startUtc() != null && booking.endUtc() != null
                && r.startUtc() != null && r.endUtc() != null
                && (!booking.startUtc().equals(r.startUtc()) || !booking.endUtc().equals(r.endUtc()));
        if (moved) {
            // The booking keeps the terms it was made under, but its free
            // cancellation deadline follows the stay's new start.
            jdbi.useExtension(com.bliss.b2b.persistence.BookingDao.class, d -> d.findCancellationTerms(
                    booking.bookingId()).ifPresent(json -> d.setFreeCancellationUntil(booking.bookingId(),
                    com.bliss.b2b.persistence.BlissRateDao.parseTerms(json)
                            .freeCancellationUntil(r.createdUtc(), r.startUtc(), zone))));
            String detail = "Bliss built the plan for " + stayLabel(booking.startUtc(), booking.endUtc(), zone)
                    + ". Mews now has " + stayLabel(r.startUtc(), r.endUtc(), zone)
                    + ". The payment schedule has not been changed.";
            return flag(merchantId, r, booking.bookingId(), FLAG_DATES_CHANGED,
                    "The dates of a Bliss booking were changed in Mews.", detail) ? 1 : 0;
        }
        return 0;
    }

    // --- Linking ------------------------------------------------------------------

    enum Attempt { LINKED, FLAGGED, WAITING, DROPPED, RATE_LIMITED }

    private Attempt attemptLink(MewsConnection conn, MewsAdapter adapter, ZoneId zone, LinkRow link,
            MewsReservation r) {
        UUID merchantId = conn.merchantId();
        Instant now = clock.instant();
        try {
            if (r == null) {
                return waiting(link, "Mews did not return the reservation");
            }
            PlanFrequency frequency = conn.frequencyForRate(r.rateId());
            if (frequency == null) {
                log.info("Mews reservation {} moved off the Bliss rates before it was linked; dropping it", r.id());
                return drop(link);
            }
            if ("Canceled".equals(r.state())) {
                // Abandoned in the booking engine (unpaid holds are cancelled by
                // Mews), or cancelled before Bliss linked it. Nothing to plan.
                log.info("Mews reservation {} was cancelled before it was linked; dropping it", r.id());
                return drop(link);
            }
            if (!BOOKED_STATES.contains(r.state())) {
                return waiting(link, "reservation is " + r.state());
            }
            boolean holdMode = jdbi.withExtension(com.bliss.b2b.persistence.BlissSettingsDao.class,
                            d -> d.find(merchantId))
                    .map(s -> s.payoutMode() == com.bliss.b2b.payments.PayoutMode.HOLD).orElse(false);
            if (holdMode) {
                // Held payments are charged in Stripe, so the card Mews holds
                // has to reach Stripe first (D1). Until it can, the stay is
                // flagged and nothing is charged through Mews.
                String why;
                if (!features.isMewsCardForwarding()) {
                    why = "Card forwarding from Mews to Stripe isn't switched on.";
                } else {
                    try {
                        cardForwarder.forward(merchantId, r.id(), null);
                        why = "Linking a forwarded card isn't built yet.";
                    } catch (RuntimeException e) {
                        why = e.getMessage();
                    }
                }
                return flagLink(link, r, FLAG_HOLD_CARD_NEEDED,
                        "A guest booked a Bliss rate, but held payments can't start yet.",
                        "Holding payments needs the guest's card in Stripe, and Bliss can't move it there "
                                + "from Mews yet. " + why + " No plan was created and nothing was charged.");
            }

            List<MewsCardPayment> payments = adapter.getReservationCardPayments(r.id());
            List<MewsCardPayment> charged = payments.stream().filter(p -> "Charged".equals(p.state())).toList();
            if (charged.isEmpty()) {
                boolean settling = payments.stream()
                        .anyMatch(p -> "Pending".equals(p.state()) || "Verifying".equals(p.state()));
                if (settling) {
                    return waiting(link, "upfront charge is still settling");
                }
                if (link.firstSeenAt().plus(UPFRONT_CHARGE_GRACE).isBefore(now)) {
                    return flagLink(link, r, FLAG_NO_UPFRONT_CHARGE,
                            "A guest booked a Bliss rate but no upfront charge was taken.",
                            "Bliss takes the guest's card from the payment Mews charges at booking. "
                                    + "This reservation has none, so no plan was created. Check that the "
                                    + "rate's payment policy charges a percentage on confirmation.");
                }
                return waiting(link, "no upfront charge yet");
            }
            List<String> cards = charged.stream().map(MewsCardPayment::creditCardId)
                    .filter(Objects::nonNull).distinct().toList();
            if (cards.size() != 1) {
                return flagLink(link, r, FLAG_LINK_FAILED,
                        "Bliss could not tell which card to use for a Bliss booking.",
                        "The upfront charge was taken on " + cards.size()
                                + " cards. No plan was created.");
            }
            String currency = conn.currency();
            for (MewsCardPayment p : charged) {
                if (!currency.equals(p.currency())) {
                    return flagLink(link, r, FLAG_LINK_FAILED,
                            "A Bliss booking was paid in an unexpected currency.",
                            "The upfront charge is in " + p.currency() + " but Bliss is set up for "
                                    + currency + ". No plan was created.");
                }
            }
            long deposit = charged.stream().mapToLong(MewsCardPayment::amountMinorUnits).sum();
            MewsCardPayment first = charged.stream()
                    .min((a, b) -> compareNullable(a.createdUtc(), b.createdUtc())).orElseThrow();

            MewsAdapter.StayPrice total = adapter.getReservationTotal(r.id());
            if (!currency.equals(total.currency())) {
                return flagLink(link, r, FLAG_LINK_FAILED,
                        "A Bliss booking is priced in an unexpected currency.",
                        "Mews prices the stay in " + total.currency() + " but Bliss is set up for "
                                + currency + ". No plan was created.");
            }
            warnIfDepositDiffers(conn, frequency, r.id(), total.totalMinorUnits(), deposit);
            PmsCustomer guest = adapter.getCustomer(r.accountId()).orElse(null);
            if (!conn.allowsGuest(guest == null ? null : guest.email())) {
                // Pending from before the allowlist was set: not this
                // property's to link. Dropped quietly; it is someone else's
                // booking, so the property is not emailed about it.
                log.info("Reservation {} is from a guest not on merchant {}'s allowlist; dropping its link",
                        r.id(), merchantId);
                return drop(link);
            }
            if (guest == null || guest.email() == null || guest.email().isBlank()) {
                return flagLink(link, r, FLAG_LINK_FAILED,
                        "A Bliss booking has no guest email.",
                        "Bliss emails the guest their payment schedule, and the guest profile in Mews "
                                + "has no email. No plan was created.");
            }
            String cardId = cards.get(0);
            PmsStoredCard card = adapter.getStoredCards(r.accountId()).stream()
                    .filter(c -> cardId.equals(c.id())).findFirst().orElse(null);
            if (card == null) {
                return flagLink(link, r, FLAG_LINK_FAILED,
                        "The card on a Bliss booking is not on the guest's profile.",
                        "The upfront charge used a card Bliss cannot find on the guest's Mews profile, "
                                + "so later payments could not be taken. No plan was created.");
            }

            LocalDate checkin = r.startUtc().atZone(zone).toLocalDate();
            LocalDate checkout = r.endUtc().atZone(zone).toLocalDate();
            long nights = ChronoUnit.DAYS.between(checkin, checkout);
            LocalDate bookedOn = (first.createdUtc() != null ? first.createdUtc() : r.createdUtc())
                    .atZone(zone).toLocalDate();

            // The rate's terms from Mews (synced now if never synced), which
            // the booking keeps whatever Mews changes later.
            com.bliss.b2b.domain.BlissRate rate = syncService == null ? null
                    : syncService.rateFor(merchantId, r.rateId()).filter(x -> x.syncedAt() != null).orElse(null);
            PlanCreationService.MewsLinkedStay stay = new PlanCreationService.MewsLinkedStay(
                    link.id(), merchantId, r.id(), r.rateId(), r.categoryId(), frequency,
                    checkin, checkout, r.startUtc(), r.endUtc(), bookedOn,
                    "Stay, " + nights + (nights == 1 ? " night" : " nights"),
                    "Mews reservation " + (r.number() != null ? r.number() : r.id()),
                    total.totalMinorUnits(), currency, deposit, first.id(),
                    first.createdUtc() != null ? first.createdUtc() : now,
                    r.accountId(), guest.email(), guest.firstName(), guest.lastName(),
                    cardId, lastFour(card.obfuscatedNumber()),
                    card.expiryMonth() == null ? 12 : card.expiryMonth(),
                    card.expiryYear() == null ? 2099 : card.expiryYear(),
                    "card",
                    rate == null ? null : rate.bookingType(),
                    rate == null ? null : rate.terms(),
                    rate == null ? null : rate.terms().freeCancellationUntil(r.createdUtc(), r.startUtc(), zone));
            try {
                var result = planCreationService.createFromMewsReservation(stay);
                if (feeLines != null) {
                    feeLines.postForPlan(merchantId, result.booking().id(), result.planId(),
                            result.plan().processingFeeCents(), currency);
                }
                log.info("Linked Mews reservation {} to plan {} ({}, total {}, deposit {} {})",
                        r.id(), result.planId(), frequency.wire(), total.totalMinorUnits(), deposit, currency);
                return Attempt.LINKED;
            } catch (PlanCreationException e) {
                return switch (e.reason()) {
                    case ELIGIBILITY_FAILED -> flagLink(link, r, FLAG_NOT_ELIGIBLE,
                            "A Bliss booking does not qualify for a payment plan.",
                            "Bliss could not build a " + frequency.wire() + " plan for this stay ("
                                    + e.getMessage() + "). No plan was created; the upfront charge "
                                    + "stays on the reservation.");
                    case BOOKING_NOT_OPEN -> Attempt.LINKED;
                    case INVALID_INPUT -> flagLink(link, r, FLAG_LINK_FAILED,
                            "Bliss could not create the plan for a Bliss booking.",
                            e.getMessage() + ". No plan was created.");
                    default -> waiting(link, e.getMessage());
                };
            }
        } catch (PmsAdapterException e) {
            waiting(link, "Mews: " + e.getMessage());
            return e.httpStatus() == 429 ? Attempt.RATE_LIMITED : Attempt.WAITING;
        }
    }

    /**
     * The pop-up quotes the deposit from the display percentage in booking
     * setup; the plan is built on what Mews actually charged. A difference
     * means the guest was shown different figures from the ones they will pay,
     * almost always because the rate's payment policy in Mews and the display
     * percentage disagree. Logged, not flagged: the plan is still right.
     * One minor unit of tolerance covers the two sides rounding differently.
     */
    void warnIfDepositDiffers(MewsConnection conn, PlanFrequency frequency, String reservationId,
            long totalCents, long depositCents) {
        Integer bps = conn.displayDepositBpsFor(frequency);
        if (bps == null) {
            return;
        }
        long expected = displayDepositCents(totalCents, bps);
        if (Math.abs(expected - depositCents) > 1) {
            log.warn("Mews reservation {} (merchant {}): upfront charge {} differs from the {} display "
                    + "deposit of {}% ({} on {}); the plan uses the actual charge",
                    reservationId, conn.merchantId(), depositCents, frequency.wire(),
                    java.math.BigDecimal.valueOf(bps, 2).stripTrailingZeros().toPlainString(),
                    expected, totalCents);
        }
    }

    /** {@code totalCents} x {@code bps} / 10000, rounded half up, in integer arithmetic. */
    static long displayDepositCents(long totalCents, int bps) {
        return (totalCents * bps + 5_000) / 10_000;
    }

    private Attempt waiting(LinkRow link, String why) {
        jdbi.useExtension(MewsLinkingDao.class, d -> d.recordAttempt(link.id(), truncate(why), clock.instant()));
        return Attempt.WAITING;
    }

    private Attempt drop(LinkRow link) {
        jdbi.useExtension(MewsLinkingDao.class, d -> d.deletePending(link.id()));
        return Attempt.DROPPED;
    }

    private Attempt flagLink(LinkRow link, MewsReservation r, String kind, String headline, String detail) {
        jdbi.useExtension(MewsLinkingDao.class, d -> d.markFlagged(link.id(), kind, clock.instant()));
        flag(link.merchantId(), r, null, kind, headline, detail);
        return Attempt.FLAGGED;
    }

    /** Raises a flag and emails the property the first time. Returns true when the flag is new. */
    private boolean flag(UUID merchantId, MewsReservation r, UUID bookingId, String kind,
            String headline, String detail) {
        boolean fresh = jdbi.withExtension(MewsLinkingDao.class,
                d -> d.insertFlag(merchantId, r.id(), bookingId, kind, headline + " " + detail)) == 1;
        if (!fresh) {
            return false;
        }
        log.warn("Mews flag {} on reservation {} (merchant {}): {}", kind, r.id(), merchantId, detail);
        Merchant merchant = jdbi.withExtension(MerchantDao.class, d -> d.findById(merchantId)).orElse(null);
        if (merchant == null) {
            return true;
        }
        try {
            emailService.send(EmailTemplates.merchantMewsFlag(merchant,
                    r.number() != null ? r.number() : r.id(), headline, detail));
            jdbi.useExtension(MewsLinkingDao.class,
                    d -> d.markFlagNotified(merchantId, r.id(), kind, clock.instant()));
        } catch (RuntimeException e) {
            log.warn("Could not email merchant {} about flag {} on {}: {}", merchantId, kind, r.id(), e.getMessage());
        }
        return true;
    }

    // --- helpers ---------------------------------------------------------------

    /** The property's zone, or null when it has none or an invalid one. */
    private static ZoneId zoneOf(MewsConnection conn) {
        if (conn.timeZone() == null || conn.timeZone().isBlank()) {
            return null;
        }
        try {
            return ZoneId.of(conn.timeZone());
        } catch (java.time.DateTimeException e) {
            return null;
        }
    }

    private static String stayLabel(Instant start, Instant end, ZoneId zone) {
        return SHORT_DATE.format(start.atZone(zone)) + " to " + SHORT_DATE.format(end.atZone(zone));
    }

    private static int compareNullable(Instant a, Instant b) {
        if (a == null) return b == null ? 0 : 1;
        if (b == null) return -1;
        return a.compareTo(b);
    }

    private static String lastFour(String obfuscated) {
        if (obfuscated == null) return "0000";
        String digits = obfuscated.replaceAll("\\D", "");
        return digits.length() >= 4 ? digits.substring(digits.length() - 4) : "0000";
    }

    private static String truncate(String s) {
        if (s == null) return null;
        return s.length() > 500 ? s.substring(0, 500) : s;
    }

    /** Counts for one pass. */
    public record PassResult(int seen, int linked, int flagged, int failedProperties) {
        static final PassResult EMPTY = new PassResult(0, 0, 0, 0);

        PassResult plus(PassResult o) {
            return new PassResult(seen + o.seen, linked + o.linked, flagged + o.flagged,
                    failedProperties + o.failedProperties);
        }
    }
}
