package com.bliss.b2b.service;

import com.bliss.b2b.integration.pms.MewsAdapter;
import com.bliss.b2b.integration.pms.PmsAdapterException;
import com.bliss.b2b.persistence.BookingDao;
import com.bliss.b2b.persistence.BookingDao.UnconfirmedMewsStay;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import org.jdbi.v3.core.Jdbi;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Background safety net for Mews reservation confirmation, run with the
 * reconciliation pass every minute.
 *
 * <p>Checkout confirms the hold right after charging the first installment
 * and retries briefly, but Mews can still refuse, and an unconfirmed
 * (Optional) hold is released by Mews at its release time while the guest has
 * paid. This works through every booking whose plan has taken money but whose
 * reservation is not recorded as confirmed:
 * <ul>
 *   <li>already confirmed in Mews (the property may have done it): recorded
 *   <li>still Optional (or another unconfirmed state): confirmed, with Mews
 *       sending the guest its confirmation email
 *   <li>cancelled in Mews: flagged once for a person, and no longer retried
 *   <li>missing, or any failure: counted and retried next minute
 * </ul>
 */
public class MewsConfirmSweep {

    private static final Logger log = LoggerFactory.getLogger(MewsConfirmSweep.class);

    /** Stored as mews_confirm_error; the query stops selecting these. */
    static final String CANCELED_IN_MEWS = "canceled in mews";
    static final Set<String> CONFIRMED_STATES = Set.of("Confirmed", "Started", "Processed");
    /** Failures are logged as errors on the first attempt and every Nth after. */
    static final int ALERT_EVERY = 10;

    /** Where the sweep reads its work and records outcomes. */
    interface Store {
        List<UnconfirmedMewsStay> findUnconfirmed();

        void markConfirmed(UUID bookingId, Instant at);

        /** Returns the booking's attempt count after this failure. */
        int recordFailure(UUID bookingId, String error);
    }

    private final Store store;
    private final Function<UUID, Optional<MewsAdapter>> adapters;
    private final Clock clock;

    public MewsConfirmSweep(Jdbi jdbi, Function<UUID, Optional<MewsAdapter>> adapters, Clock clock) {
        this(new JdbiStore(jdbi), adapters, clock);
    }

    MewsConfirmSweep(Store store, Function<UUID, Optional<MewsAdapter>> adapters, Clock clock) {
        this.store = store;
        this.adapters = adapters;
        this.clock = clock;
    }

    /** One pass. Returns how many reservations ended the pass confirmed. */
    public int run() {
        int confirmed = 0;
        for (UnconfirmedMewsStay stay : store.findUnconfirmed()) {
            Optional<MewsAdapter> adapter = adapters.apply(stay.merchantId());
            if (adapter.isEmpty()) {
                continue; // no validated connection: nothing can be done from here
            }
            if (sweepOne(stay, adapter.get())) {
                confirmed++;
            }
        }
        return confirmed;
    }

    private boolean sweepOne(UnconfirmedMewsStay stay, MewsAdapter adapter) {
        String reservationId = stay.reservationId();
        Optional<String> state;
        try {
            state = adapter.getReservationState(reservationId);
        } catch (PmsAdapterException e) {
            fail(stay, "could not read reservation: " + e.getMessage());
            return false;
        }
        if (state.isEmpty()) {
            fail(stay, "reservation not found in Mews");
            return false;
        }
        if (CONFIRMED_STATES.contains(state.get())) {
            store.markConfirmed(stay.bookingId(), Instant.now(clock));
            return true;
        }
        if ("Canceled".equals(state.get())) {
            store.recordFailure(stay.bookingId(), CANCELED_IN_MEWS);
            log.error("Mews reservation {} for booking {} is canceled in Mews but the guest has paid. "
                    + "Needs a person: rebook the stay or cancel the plan.", reservationId, stay.bookingId());
            return false;
        }
        try {
            adapter.confirmReservation(reservationId, true);
        } catch (PmsAdapterException e) {
            fail(stay, "confirm failed: " + e.getMessage());
            return false;
        }
        store.markConfirmed(stay.bookingId(), Instant.now(clock));
        log.info("Mews reservation {} for booking {} confirmed by the background pass (was {})",
                reservationId, stay.bookingId(), state.get());
        return true;
    }

    private void fail(UnconfirmedMewsStay stay, String error) {
        int attempts = store.recordFailure(stay.bookingId(), error);
        if (attempts == 1 || attempts % ALERT_EVERY == 0) {
            log.error("Mews reservation {} for paid booking {} still unconfirmed after {} background attempt(s): {}",
                    stay.reservationId(), stay.bookingId(), attempts, error);
        }
    }

    private static final class JdbiStore implements Store {
        private final Jdbi jdbi;

        JdbiStore(Jdbi jdbi) {
            this.jdbi = jdbi;
        }

        @Override
        public List<UnconfirmedMewsStay> findUnconfirmed() {
            return jdbi.withHandle(h -> h.attach(BookingDao.class).findUnconfirmedMewsStays());
        }

        @Override
        public void markConfirmed(UUID bookingId, Instant at) {
            jdbi.useHandle(h -> h.attach(BookingDao.class).markMewsConfirmed(bookingId, at));
        }

        @Override
        public int recordFailure(UUID bookingId, String error) {
            return jdbi.withHandle(h -> h.attach(BookingDao.class).recordMewsConfirmFailure(bookingId, error));
        }
    }
}
