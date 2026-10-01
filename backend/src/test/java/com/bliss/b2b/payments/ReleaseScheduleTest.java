package com.bliss.b2b.payments;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.time.Instant;
import org.junit.jupiter.api.Test;

/** Hold mode release points (spec section 2.3). */
class ReleaseScheduleTest {

    private static final Instant PAID = Instant.parse("2026-10-01T15:00:00Z");
    private static final Instant DEADLINE = Instant.parse("2027-03-01T05:00:00Z");
    private static final Instant ARRIVAL = Instant.parse("2027-03-15T05:00:00Z");

    @Test
    void aRefundablePaymentIsReleasedAtTheEndOfFreeCancellation() {
        assertThat(ReleaseSchedule.releaseAt(ReleasePolicy.CANCELLATION_DEADLINE, BookingType.REFUNDABLE,
                DEADLINE, ARRIVAL, 3, PAID, null)).isEqualTo(DEADLINE);
    }

    @Test
    void aPaymentSettlingAfterTheDeadlineIsReleasedAsItSettles() {
        Instant late = DEADLINE.plus(Duration.ofDays(4));
        assertThat(ReleaseSchedule.releaseAt(ReleasePolicy.CANCELLATION_DEADLINE, BookingType.REFUNDABLE,
                DEADLINE, ARRIVAL, 3, late, null)).isEqualTo(late);
    }

    @Test
    void withNoDeadlineARefundablePaymentWaitsForArrival() {
        assertThat(ReleaseSchedule.releaseAt(ReleasePolicy.CANCELLATION_DEADLINE, null, null, ARRIVAL, 3, PAID,
                null)).isEqualTo(ARRIVAL);
    }

    @Test
    void aNonRefundablePaymentIsReleasedOnCollectionAfterTheBuffer() {
        assertThat(ReleaseSchedule.releaseAt(ReleasePolicy.CANCELLATION_DEADLINE, BookingType.NON_REFUNDABLE,
                null, ARRIVAL, 3, PAID, null)).isEqualTo(PAID.plus(Duration.ofDays(3)));
    }

    @Test
    void checkInHoldsEverythingUntilArrival_onCollectionReleasesAfterTheBuffer() {
        assertThat(ReleaseSchedule.releaseAt(ReleasePolicy.CHECK_IN, BookingType.NON_REFUNDABLE, null, ARRIVAL, 3,
                PAID, null)).isEqualTo(ARRIVAL);
        assertThat(ReleaseSchedule.releaseAt(ReleasePolicy.ON_COLLECTION, BookingType.REFUNDABLE, DEADLINE, ARRIVAL,
                7, PAID, null)).isEqualTo(PAID.plus(Duration.ofDays(7)));
    }

    @Test
    void stripesMaximumHoldCapsTheReleaseOnceKnown() {
        assertThat(ReleaseSchedule.releaseAt(ReleasePolicy.CHECK_IN, BookingType.REFUNDABLE, null, ARRIVAL, 3, PAID,
                Duration.ofDays(90))).isEqualTo(PAID.plus(Duration.ofDays(90)));
    }
}
