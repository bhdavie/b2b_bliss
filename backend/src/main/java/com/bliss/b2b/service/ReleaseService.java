package com.bliss.b2b.service;

import com.bliss.b2b.BlissConfiguration.FeaturesConfig;
import com.bliss.b2b.domain.BlissSettings;
import com.bliss.b2b.domain.Booking;
import com.bliss.b2b.domain.Merchant;
import com.bliss.b2b.domain.MewsConnection;
import com.bliss.b2b.integration.EmailService;
import com.bliss.b2b.integration.EmailTemplates;
import com.bliss.b2b.integration.StripePaymentsService;
import com.bliss.b2b.integration.pms.MewsAdapter;
import com.bliss.b2b.integration.pms.MewsAdapterFactory;
import com.bliss.b2b.payments.BookingType;
import com.bliss.b2b.payments.ReleaseSchedule;
import com.bliss.b2b.persistence.BlissSettingsDao;
import com.bliss.b2b.persistence.BookingDao;
import com.bliss.b2b.persistence.FolioPostingDao;
import com.bliss.b2b.persistence.FolioPostingDao.Posting;
import com.bliss.b2b.persistence.MerchantDao;
import com.bliss.b2b.persistence.MerchantMewsConnectionDao;
import com.bliss.b2b.persistence.PaymentPlanDao;
import com.bliss.b2b.persistence.PayoutReleaseDao;
import com.bliss.b2b.persistence.PayoutReleaseDao.Release;
import com.bliss.b2b.persistence.PayoutReleaseDao.Unscheduled;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.jdbi.v3.core.Jdbi;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Hold mode (configurable-property spec, section 2.2): money a guest pays
 * stays in the platform's Stripe balance until its release point, then is
 * transferred to the property's Express account, less the Bliss fee, and
 * recorded in the Mews folio as a ledger-only payment.
 *
 * <p>Each pass: every newly paid payment on a hold-mode booking gets a release
 * row ({@code payment:{schedule id}}) dated by {@link ReleaseSchedule}; every
 * release whose point has passed is transferred under the plan lock, at most
 * once (the release row is the Stripe idempotency key); ledger payments still
 * waiting are posted. A cancellation settles the property's share at once
 * ({@link #settleCancellation}).
 *
 * <p>Inert for properties in pay as you go mode: only bookings that
 * snapshotted {@code payout_mode = 'hold'} are touched, and a property can only
 * switch to hold mode with the holdMode flag on.
 */
public class ReleaseService {

    private static final Logger log = LoggerFactory.getLogger(ReleaseService.class);
    /** Slack around a posting's lifetime when searching Mews for an earlier attempt. */
    private static final Duration SEARCH_MARGIN = Duration.ofHours(1);

    /** The Stripe money movements a release needs; a seam so tests run without Stripe. */
    public interface Transfers {
        /** Transfers to the property; returns the transfer id. Idempotent on {@code key}. */
        String transfer(String accountId, long amountMinor, String currency, String transferGroup, String key,
                Map<String, String> metadata) throws Exception;

        /** Pulls part of a transfer back to the platform. Idempotent on {@code key}. */
        void reverse(String transferId, long amountMinor, String key) throws Exception;

        /** Debits the property's account to the platform; returns the transfer id. Idempotent on {@code key}. */
        String debit(String accountId, long amountMinor, String currency, String key) throws Exception;
    }

    /** Stripe when configured; otherwise demo ids, the way demo charges work. */
    public static Transfers stripeTransfers(StripePaymentsService stripe) {
        return new Transfers() {
            @Override
            public String transfer(String accountId, long amountMinor, String currency, String transferGroup,
                    String key, Map<String, String> metadata) throws Exception {
                if (stripe == null || !stripe.isConfigured() || accountId.startsWith("acct_demo_")) {
                    return "tr_demo_" + UUID.randomUUID().toString().replace("-", "").substring(0, 16);
                }
                return stripe.transferToProperty(accountId, amountMinor, currency, transferGroup, key, metadata)
                        .getId();
            }

            @Override
            public void reverse(String transferId, long amountMinor, String key) throws Exception {
                if (transferId.startsWith("tr_demo_") || stripe == null || !stripe.isConfigured()) {
                    return;
                }
                stripe.reverseTransfer(transferId, amountMinor, key);
            }

            @Override
            public String debit(String accountId, long amountMinor, String currency, String key) throws Exception {
                if (stripe == null || !stripe.isConfigured() || accountId.startsWith("acct_demo_")) {
                    return "tr_demo_" + UUID.randomUUID().toString().replace("-", "").substring(0, 16);
                }
                return stripe.debitPropertyAccount(accountId, amountMinor, currency, key).getId();
            }
        };
    }

    private final Jdbi jdbi;
    private final Transfers transfers;
    private final MewsAdapterFactory mewsFactory;
    private final EmailService emailService;
    private final FeaturesConfig features;
    private final Clock clock;

    public ReleaseService(Jdbi jdbi, Transfers transfers, MewsAdapterFactory mewsFactory,
            EmailService emailService, FeaturesConfig features, Clock clock) {
        this.jdbi = jdbi;
        this.transfers = transfers;
        this.mewsFactory = mewsFactory;
        this.emailService = emailService;
        this.features = features == null ? new FeaturesConfig() : features;
        this.clock = clock;
    }

    /** One pass. Returns the number of releases transferred. */
    public int run() {
        schedulePending();
        int released = releaseDue();
        retryLedger();
        return released;
    }

    // --- Scheduling -------------------------------------------------------------

    /** Gives every newly paid payment on a hold-mode booking its release row. */
    public int schedulePending() {
        int scheduled = 0;
        Duration maxHold = features.getHoldMaxDays() == null ? null : Duration.ofDays(features.getHoldMaxDays());
        for (Unscheduled u : jdbi.withExtension(PayoutReleaseDao.class, PayoutReleaseDao::unscheduledPayments)) {
            try {
                scheduled += jdbi.withHandle(h -> {
                    Booking booking = h.attach(BookingDao.class).findById(u.bookingId()).orElseThrow();
                    BlissSettings settings = h.attach(BlissSettingsDao.class).find(u.merchantId())
                            .orElse(BlissSettings.defaults(u.merchantId()));
                    long fee = StripePaymentsService.applicationFeeCents(u.amountCents(),
                            h.attach(MerchantDao.class).findFeePercentage(u.merchantId()).orElse(null));
                    Instant at = ReleaseSchedule.releaseAt(settings.releasePolicy(), bookingType(booking),
                            booking.freeCancellationUntil(), arrival(booking), settings.chargebackBufferDays(),
                            u.paidAt(), maxHold);
                    return h.attach(PayoutReleaseDao.class).insert(u.bookingId(), u.planId(),
                            "payment:" + u.scheduleId(), at, u.amountCents() - fee, fee, booking.currency());
                });
            } catch (RuntimeException e) {
                log.warn("Could not schedule the release of payment {}: {}", u.scheduleId(), e.toString());
            }
        }
        return scheduled;
    }

    // --- Releasing --------------------------------------------------------------

    /** Transfers every release whose point has passed. Returns how many were transferred. */
    public int releaseDue() {
        Map<UUID, List<Release>> releasedByMerchant = new LinkedHashMap<>();
        int released = 0;
        for (Release r : jdbi.withExtension(PayoutReleaseDao.class, d -> d.due(clock.instant()))) {
            Optional<Release> done = releaseOne(r.id());
            if (done.isPresent()) {
                released++;
                Booking booking = jdbi.withExtension(BookingDao.class, d -> d.findById(r.bookingId())).orElseThrow();
                releasedByMerchant.computeIfAbsent(booking.merchantId(), k -> new ArrayList<>()).add(done.get());
                postLedger(done.get(), booking);
            }
        }
        releasedByMerchant.forEach(this::emailReleased);
        return released;
    }

    /**
     * Transfers one release under its plan's lock, re-checking under the lock
     * that it is still scheduled. Returns the released row, or empty when it
     * was not (already released, cancelled, or Stripe refused it, which is
     * recorded for the next pass).
     */
    Optional<Release> releaseOne(UUID releaseId) {
        try {
            return jdbi.inTransaction(h -> {
                PayoutReleaseDao dao = h.attach(PayoutReleaseDao.class);
                Release r = dao.find(releaseId).orElseThrow();
                h.attach(PaymentPlanDao.class).lockForUpdate(r.planId());
                r = dao.find(releaseId).orElseThrow();
                if (!"scheduled".equals(r.status())) {
                    return Optional.<Release>empty();
                }
                Booking booking = h.attach(BookingDao.class).findById(r.bookingId()).orElseThrow();
                String account = h.attach(MerchantDao.class).findById(booking.merchantId())
                        .map(Merchant::stripeConnectAccountId).orElse(null);
                if (account == null || account.isBlank()) {
                    throw new IllegalStateException("the property has no Express account to release to");
                }
                String transferId = r.amountMinor() == 0 ? null : transfers.transfer(account, r.amountMinor(),
                        r.currency(), "booking_" + r.bookingId(), "release:" + r.id(),
                        Map.of("bliss_booking_id", r.bookingId().toString(), "bliss_release_id", r.id().toString(),
                                "bliss_step", r.step()));
                dao.markReleased(r.id(), transferId, clock.instant());
                log.info("Released {} {} to {} for booking {} ({}), transfer {}", r.amountMinor(), r.currency(),
                        account, r.bookingId(), r.step(), transferId);
                return dao.find(r.id());
            });
        } catch (Exception e) {
            log.warn("Release {} failed; it stays scheduled for the next pass: {}", releaseId, e.toString());
            jdbi.useExtension(PayoutReleaseDao.class, d -> d.recordFailure(releaseId, truncate(e.toString())));
            return Optional.empty();
        }
    }

    // --- Cancellation -----------------------------------------------------------

    /**
     * What a cancellation leaves the property: {@code propertyShareMinor}, the
     * part of the money collected that it keeps (spec 3.2, hold mode column).
     * Releases still waiting are cancelled; then the property is topped up with
     * a "cancellation" release, or the excess it was already given is pulled back
     * by transfer reversal (newest first) so the guest's refund is funded from
     * the platform balance. A negative share is the part of the Bliss fee the
     * property funds (D9: Bliss never gives its fee back): everything released
     * is pulled back and the rest is debited from the property's account.
     * Returns what could not be collected, which is zero unless Stripe refused.
     */
    public long settleCancellation(UUID planId, UUID bookingId, long propertyShareMinor, String currency) {
        jdbi.useExtension(PayoutReleaseDao.class, d -> d.cancelScheduled(bookingId));
        List<Release> rows = jdbi.withExtension(PayoutReleaseDao.class, d -> d.forBooking(bookingId));
        long held = rows.stream().mapToLong(Release::heldByPropertyMinor).sum();
        long target = Math.max(0L, propertyShareMinor);
        long feeOwed = Math.max(0L, -propertyShareMinor);

        if (target > held) {
            long topUp = target - held;
            jdbi.useExtension(PayoutReleaseDao.class,
                    d -> d.insert(bookingId, planId, "cancellation", clock.instant(), topUp, 0L, currency));
            rows = jdbi.withExtension(PayoutReleaseDao.class, d -> d.forBooking(bookingId));
            rows.stream().filter(r -> "cancellation".equals(r.step()) && "scheduled".equals(r.status()))
                    .findFirst()
                    .flatMap(r -> releaseOne(r.id()))
                    .ifPresent(r -> postLedger(r, jdbi.withExtension(BookingDao.class,
                            d -> d.findById(bookingId)).orElseThrow()));
            return 0L;
        }

        long toPull = held - target;
        List<Release> newestFirst = new ArrayList<>(rows);
        java.util.Collections.reverse(newestFirst);
        for (Release r : newestFirst) {
            if (toPull <= 0) break;
            long available = r.heldByPropertyMinor();
            if (available <= 0 || r.stripeTransferId() == null) continue;
            long amount = Math.min(available, toPull);
            try {
                transfers.reverse(r.stripeTransferId(), amount, "cancel-reverse:" + r.id());
                jdbi.useExtension(PayoutReleaseDao.class, d -> d.recordReversal(r.id(), amount));
                toPull -= amount;
            } catch (Exception e) {
                log.warn("Could not reverse {} of release {} for booking {}: {}", amount, r.id(), bookingId,
                        e.toString());
                jdbi.useExtension(PayoutReleaseDao.class, d -> d.recordFailure(r.id(), truncate(e.toString())));
            }
        }
        if (toPull > 0) {
            log.error("Cancelling booking {}: {} {} released to the property could not be pulled back; "
                    + "the refund is short by that much from the platform balance", bookingId, toPull, currency);
        }
        return Math.max(0L, toPull) + debitFee(planId, bookingId, feeOwed, currency);
    }

    /** Debits the Bliss fee the property funds on a refund; recorded as a "fee_debit" row. */
    private long debitFee(UUID planId, UUID bookingId, long feeOwed, String currency) {
        if (feeOwed <= 0) {
            return 0L;
        }
        jdbi.useExtension(PayoutReleaseDao.class,
                d -> d.insert(bookingId, planId, "fee_debit", clock.instant(), 0L, feeOwed, currency));
        Release row = jdbi.withExtension(PayoutReleaseDao.class, d -> d.forBooking(bookingId)).stream()
                .filter(r -> "fee_debit".equals(r.step())).findFirst().orElseThrow();
        if (!"scheduled".equals(row.status())) {
            return 0L;
        }
        try {
            Booking booking = jdbi.withExtension(BookingDao.class, d -> d.findById(bookingId)).orElseThrow();
            String account = jdbi.withExtension(MerchantDao.class, d -> d.findById(booking.merchantId()))
                    .map(Merchant::stripeConnectAccountId).orElseThrow();
            String id = transfers.debit(account, feeOwed, currency, "fee-debit:" + row.id());
            jdbi.useExtension(PayoutReleaseDao.class, d -> d.markReleased(row.id(), id, clock.instant()));
            log.info("Debited {} {} of the Bliss fee from {} for booking {} ({})", feeOwed, currency, account,
                    bookingId, id);
            return 0L;
        } catch (Exception e) {
            // Left scheduled with the error; an admin collects it by hand.
            log.error("Could not debit {} {} of the Bliss fee for booking {}: {}", feeOwed, currency, bookingId,
                    e.toString());
            jdbi.useExtension(PayoutReleaseDao.class, d -> d.recordFailure(row.id(), truncate(e.toString())));
            return feeOwed;
        }
    }

    // --- Ledger payments in Mews ------------------------------------------------

    /**
     * Records a release in the Mews folio of a linked stay: a ledger payment
     * for the property's share and a matching one for the Bliss fee, so the
     * folio, which carries the stay and the fee line, closes at zero (D15).
     * Claimed before Mews is called, posted at most once.
     */
    void postLedger(Release r, Booking booking) {
        if (booking.mewsReservationId() == null) {
            return;
        }
        jdbi.useExtension(FolioPostingDao.class, d -> {
            if (r.amountMinor() > 0) {
                d.claim(booking.id(), "ledger_payment", "ledger:" + r.id(), r.amountMinor(), r.currency());
            }
            if (r.feeMinor() > 0) {
                d.claim(booking.id(), "ledger_fee", "ledger_fee:" + r.id(), r.feeMinor(), r.currency());
            }
        });
        for (String key : List.of("ledger:" + r.id(), "ledger_fee:" + r.id())) {
            jdbi.withExtension(FolioPostingDao.class, d -> d.find(key))
                    .filter(p -> "pending".equals(p.status()))
                    .ifPresent(p -> attemptLedger(booking, p));
        }
    }

    /** Posts every ledger payment still waiting (Mews was down, or no payment type was chosen yet). */
    public int retryLedger() {
        int posted = 0;
        List<Posting> pending = jdbi.withHandle(h -> h.createQuery("""
                        SELECT * FROM folio_postings
                        WHERE status = 'pending' AND kind IN ('ledger_payment', 'ledger_fee')
                        ORDER BY created_at""")
                .map(org.jdbi.v3.core.mapper.reflect.ConstructorMapper.of(Posting.class)).list());
        for (Posting p : pending) {
            Booking booking = jdbi.withExtension(BookingDao.class, d -> d.findById(p.bookingId())).orElse(null);
            if (booking != null && attemptLedger(booking, p)) posted++;
        }
        return posted;
    }

    private boolean attemptLedger(Booking booking, Posting posting) {
        UUID merchantId = booking.merchantId();
        String type = jdbi.withExtension(BlissSettingsDao.class, d -> d.find(merchantId))
                .map(BlissSettings::ledgerPaymentType).orElse(null);
        if (type == null || type.isBlank()) {
            // TODO(D16): the external payment type is agreed with the property's
            // accounting; until it is set the ledger payment waits.
            return false;
        }
        try {
            MewsConnection conn = jdbi.withExtension(MerchantMewsConnectionDao.class,
                    d -> d.findByMerchant(merchantId)).orElseThrow();
            MewsAdapter adapter = mewsFactory.adapterForConnection(conn);
            String account = jdbi.withHandle(h -> h.createQuery("""
                            SELECT c.mews_customer_id FROM payment_plans pp
                            JOIN customers c ON c.id = pp.customer_id
                            WHERE pp.booking_id = :b ORDER BY pp.created_at DESC LIMIT 1""")
                    .bind("b", booking.id()).mapTo(String.class).findOne()).orElse(null);
            if (account == null) {
                throw new IllegalStateException("no Mews customer for booking " + booking.id());
            }
            Instant now = clock.instant();
            // Never twice: an earlier attempt may have posted without Bliss hearing back.
            Optional<String> existing = adapter.findExternalPayment(account,
                    posting.createdAt().minus(SEARCH_MARGIN), now.plus(SEARCH_MARGIN), posting.idempotencyKey());
            String id = existing.isPresent() ? existing.get() : adapter.addExternalPayment(account,
                    booking.mewsReservationId(), posting.amountMinor(), posting.currency(), type,
                    posting.idempotencyKey(), "ledger_fee".equals(posting.kind())
                            ? "Bliss service fee, held by Bliss"
                            : "Paid through Bliss, released to the property");
            jdbi.useExtension(FolioPostingDao.class, d -> d.markPosted(posting.id(), id, now));
            return true;
        } catch (RuntimeException e) {
            log.warn("Ledger payment {} not posted yet: {}", posting.idempotencyKey(), e.toString());
            jdbi.useExtension(FolioPostingDao.class, d -> d.recordFailure(posting.id(), truncate(e.toString())));
            return false;
        }
    }

    // --- Emails -----------------------------------------------------------------

    private void emailReleased(UUID merchantId, List<Release> released) {
        if (emailService == null) return;
        try {
            Merchant merchant = jdbi.withExtension(MerchantDao.class, d -> d.findById(merchantId)).orElseThrow();
            List<EmailTemplates.ReleasedLine> lines = new ArrayList<>();
            for (Release r : released) {
                Booking b = jdbi.withExtension(BookingDao.class, d -> d.findById(r.bookingId())).orElseThrow();
                String number = jdbi.withHandle(h -> h.createQuery(
                                "SELECT mews_reservation_number FROM bookings WHERE id = :b")
                        .bind("b", b.id()).mapTo(String.class).findOne()).orElse(null);
                lines.add(new EmailTemplates.ReleasedLine(b.serviceName(), b.appointmentDate(), r.amountMinor(),
                        r.currency(), b.localeTag(), number));
            }
            emailService.send(EmailTemplates.holdReleased(merchant, lines));
        } catch (RuntimeException e) {
            log.warn("Release email to merchant {} not sent: {}", merchantId, e.toString());
        }
    }

    // --- Helpers ----------------------------------------------------------------

    static BookingType bookingType(Booking b) {
        return b.bookingType() == null ? null : BookingType.fromWire(b.bookingType());
    }

    static Instant arrival(Booking b) {
        return b.mewsStartUtc() != null ? b.mewsStartUtc()
                : b.appointmentDate().atStartOfDay(b.propertyLocale().zone()).toInstant();
    }

    private static String truncate(String s) {
        return s == null || s.length() <= 500 ? s : s.substring(0, 500);
    }
}
