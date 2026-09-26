package com.bliss.b2b.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.bliss.b2b.BlissConfiguration.PmsConfig.MewsPmsConfig;
import com.bliss.b2b.integration.pms.MewsAdapter;
import com.bliss.b2b.integration.pms.PmsAdapterException;
import com.bliss.b2b.persistence.BookingDao.UnconfirmedMewsStay;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class MewsConfirmSweepTest {

    private static final Clock CLOCK = Clock.fixed(Instant.parse("2026-09-26T16:00:00Z"), ZoneOffset.UTC);

    private final UnconfirmedMewsStay stay =
            new UnconfirmedMewsStay(UUID.randomUUID(), UUID.randomUUID(), "res_1", 0);

    @Test
    void optionalHoldIsConfirmedWithTheGuestEmail() {
        FakeAdapter adapter = new FakeAdapter("Optional");
        FakeStore store = new FakeStore(stay);

        int confirmed = sweep(store, adapter).run();

        assertThat(confirmed).isEqualTo(1);
        assertThat(adapter.confirmedWithEmail).containsExactly(true);
        assertThat(store.confirmedAt).containsKey(stay.bookingId());
        assertThat(store.failures).isEmpty();
    }

    @Test
    void alreadyConfirmedInMewsIsJustRecorded() {
        for (String state : List.of("Confirmed", "Started", "Processed")) {
            FakeAdapter adapter = new FakeAdapter(state);
            FakeStore store = new FakeStore(stay);

            sweep(store, adapter).run();

            assertThat(adapter.confirmedWithEmail).as(state).isEmpty();
            assertThat(store.confirmedAt).as(state).containsKey(stay.bookingId());
        }
    }

    @Test
    void canceledInMewsIsFlaggedAndNotConfirmed() {
        FakeAdapter adapter = new FakeAdapter("Canceled");
        FakeStore store = new FakeStore(stay);

        sweep(store, adapter).run();

        assertThat(adapter.confirmedWithEmail).isEmpty();
        assertThat(store.confirmedAt).isEmpty();
        assertThat(store.failures).containsExactly(MewsConfirmSweep.CANCELED_IN_MEWS);
    }

    @Test
    void refusedConfirmIsCountedForTheNextPass() {
        FakeAdapter adapter = new FakeAdapter("Optional");
        adapter.confirmFails = true;
        FakeStore store = new FakeStore(stay);

        assertThat(sweep(store, adapter).run()).isZero();
        assertThat(store.confirmedAt).isEmpty();
        assertThat(store.failures).singleElement().asString().startsWith("confirm failed");
    }

    @Test
    void unreadableOrMissingReservationIsCounted() {
        FakeAdapter unreadable = new FakeAdapter(null);
        FakeStore s1 = new FakeStore(stay);
        sweep(s1, unreadable).run();
        assertThat(s1.failures).singleElement().asString().startsWith("could not read reservation");

        FakeAdapter missing = new FakeAdapter("");
        FakeStore s2 = new FakeStore(stay);
        sweep(s2, missing).run();
        assertThat(s2.failures).containsExactly("reservation not found in Mews");
    }

    @Test
    void propertyWithoutAConnectionIsSkipped() {
        FakeStore store = new FakeStore(stay);

        new MewsConfirmSweep(store, merchantId -> Optional.empty(), CLOCK).run();

        assertThat(store.confirmedAt).isEmpty();
        assertThat(store.failures).isEmpty();
    }

    private static MewsConfirmSweep sweep(FakeStore store, FakeAdapter adapter) {
        return new MewsConfirmSweep(store, merchantId -> Optional.of(adapter), CLOCK);
    }

    private static final class FakeStore implements MewsConfirmSweep.Store {
        private final List<UnconfirmedMewsStay> rows;
        final Map<UUID, Instant> confirmedAt = new HashMap<>();
        final List<String> failures = new ArrayList<>();

        FakeStore(UnconfirmedMewsStay... rows) {
            this.rows = List.of(rows);
        }

        @Override public List<UnconfirmedMewsStay> findUnconfirmed() {
            return rows;
        }

        @Override public void markConfirmed(UUID bookingId, Instant at) {
            confirmedAt.put(bookingId, at);
        }

        @Override public int recordFailure(UUID bookingId, String error) {
            failures.add(error);
            return failures.size();
        }
    }

    /**
     * state: a Mews state; "" for a reservation Mews does not return; null to
     * make the read fail.
     */
    private static final class FakeAdapter extends MewsAdapter {
        private final String state;
        boolean confirmFails;
        final List<Boolean> confirmedWithEmail = new ArrayList<>();

        FakeAdapter(String state) {
            super(configured());
            this.state = state;
        }

        @Override
        public Optional<String> getReservationState(String reservationId) {
            if (state == null) {
                throw new PmsAdapterException("Mews HTTP 503");
            }
            return state.isEmpty() ? Optional.empty() : Optional.of(state);
        }

        @Override
        public void confirmReservation(String reservationId, boolean sendEmail) {
            if (confirmFails) {
                throw new PmsAdapterException("Mews returned HTTP 403", 403, "ReservationIdDuplicityErrorMessage");
            }
            confirmedWithEmail.add(sendEmail);
        }

        private static MewsPmsConfig configured() {
            MewsPmsConfig c = new MewsPmsConfig();
            c.setPlatformUrl("https://api.mews-demo.com");
            c.setClientToken("ct");
            c.setAccessToken("at");
            return c;
        }
    }
}
