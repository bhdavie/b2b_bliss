package com.bliss.b2b.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.bliss.b2b.BlissConfiguration.PmsConfig.MewsPmsConfig;
import com.bliss.b2b.integration.pms.MewsAdapter;
import com.bliss.b2b.integration.pms.PmsAdapterException;
import java.time.Duration;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;

/**
 * Confirming the hold after the first charge. Mews has been seen to refuse a
 * confirm sent straight after a charge (403 "ReservationIdDuplicityErrorMessage")
 * and accept the same confirm moments later.
 */
class MewsConfirmRetryTest {

    @Test
    void confirmsFirstTime() {
        FakeAdapter a = new FakeAdapter().confirmResults(true);
        List<Duration> sleeps = new ArrayList<>();

        assertThat(MewsCheckoutService.confirmWithRetry(a, "res", "plan", sleeps::add)).isTrue();
        assertThat(a.confirms).isEqualTo(1);
        assertThat(sleeps).isEmpty();
    }

    @Test
    void transientRefusalIsRetriedWithBackoff() {
        FakeAdapter a = new FakeAdapter().confirmResults(false, true);
        List<Duration> sleeps = new ArrayList<>();

        assertThat(MewsCheckoutService.confirmWithRetry(a, "res", "plan", sleeps::add)).isTrue();
        assertThat(a.confirms).isEqualTo(2);
        assertThat(sleeps).containsExactly(Duration.ofSeconds(1));
    }

    @Test
    void refusedButAlreadyConfirmedStopsRetrying() {
        FakeAdapter a = new FakeAdapter().confirmResults(false);
        a.state = "Confirmed";
        List<Duration> sleeps = new ArrayList<>();

        assertThat(MewsCheckoutService.confirmWithRetry(a, "res", "plan", sleeps::add)).isTrue();
        assertThat(a.confirms).isEqualTo(1);
        assertThat(sleeps).isEmpty();
    }

    @Test
    void givesUpAfterThreeAttempts() {
        FakeAdapter a = new FakeAdapter().confirmResults(false, false, false);
        List<Duration> sleeps = new ArrayList<>();

        assertThat(MewsCheckoutService.confirmWithRetry(a, "res", "plan", sleeps::add)).isFalse();
        assertThat(a.confirms).isEqualTo(MewsCheckoutService.CONFIRM_ATTEMPTS);
        assertThat(sleeps).containsExactly(Duration.ofSeconds(1), Duration.ofSeconds(2));
    }

    /** Only confirmReservation and getReservationState are exercised. */
    private static final class FakeAdapter extends MewsAdapter {
        private final Deque<Boolean> confirmOutcomes = new ArrayDeque<>();
        int confirms;
        String state = "Optional";

        FakeAdapter() {
            super(configured());
        }

        FakeAdapter confirmResults(Boolean... outcomes) {
            confirmOutcomes.addAll(List.of(outcomes));
            return this;
        }

        @Override
        public void confirmReservation(String reservationId, boolean sendEmail) {
            confirms++;
            if (!confirmOutcomes.removeFirst()) {
                throw new PmsAdapterException("Mews returned HTTP 403", 403, "[! 'ReservationIdDuplicityErrorMessage' !]");
            }
        }

        @Override
        public Optional<String> getReservationState(String reservationId) {
            return Optional.of(state);
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
