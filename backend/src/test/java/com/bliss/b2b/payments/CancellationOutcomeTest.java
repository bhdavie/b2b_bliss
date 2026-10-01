package com.bliss.b2b.payments;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/** The configurable-property cancellation outcome table (spec section 3.2). */
class CancellationOutcomeTest {

    @Test
    void refundableBeforeTheDeadlineReturnsEverything_theBlissFeeIncluded() {
        CancellationOutcome o = CancellationOutcome.of(BookingType.REFUNDABLE, true, 60_000, 2_000, 30_000);

        assertThat(o.kind()).isEqualTo(CancellationOutcome.Kind.FULL_REFUND);
        assertThat(o.returnedMinor()).isEqualTo(60_000);
        assertThat(o.keptByPropertyMinor()).isZero();
        assertThat(o.keptBlissFeeMinor()).isZero();
    }

    @Test
    void refundableAfterTheDeadlineKeepsThePolicyFee_theBlissFeeWithinIt() {
        CancellationOutcome o = CancellationOutcome.of(BookingType.REFUNDABLE, false, 60_000, 2_000, 30_000);

        assertThat(o.kind()).isEqualTo(CancellationOutcome.Kind.PENALTY);
        assertThat(o.keptByPropertyMinor()).isEqualTo(28_000);
        assertThat(o.keptBlissFeeMinor()).isEqualTo(2_000);
        assertThat(o.returnedMinor()).isEqualTo(30_000);
    }

    @Test
    void aPenaltySmallerThanTheBlissFeeIsAllBlissFee() {
        CancellationOutcome o = CancellationOutcome.of(BookingType.REFUNDABLE, false, 60_000, 2_000, 500);

        assertThat(o.keptBlissFeeMinor()).isEqualTo(500);
        assertThat(o.keptByPropertyMinor()).isZero();
        assertThat(o.returnedMinor()).isEqualTo(59_500);
    }

    @Test
    void aPenaltyLargerThanWhatWasPaidKeepsOnlyWhatWasPaid() {
        CancellationOutcome o = CancellationOutcome.of(BookingType.REFUNDABLE, false, 20_000, 2_000, 120_000);

        assertThat(o.keptByPropertyMinor()).isEqualTo(18_000);
        assertThat(o.keptBlissFeeMinor()).isEqualTo(2_000);
        assertThat(o.returnedMinor()).isZero();
    }

    @Test
    void nonRefundableKeepsEverythingWhateverTheDeadline() {
        for (boolean before : new boolean[] {true, false}) {
            CancellationOutcome o = CancellationOutcome.of(BookingType.NON_REFUNDABLE, before, 60_000, 2_000, 0);

            assertThat(o.kind()).isEqualTo(CancellationOutcome.Kind.FORFEIT);
            assertThat(o.returnedMinor()).isZero();
            assertThat(o.keptByPropertyMinor()).isEqualTo(60_000);
        }
    }

    @Test
    void theAmountsAlwaysAddUpToWhatWasCollected() {
        for (long penalty : new long[] {0, 1_000, 59_000, 61_000}) {
            CancellationOutcome o = CancellationOutcome.of(BookingType.REFUNDABLE, false, 60_000, 2_000, penalty);
            assertThat(o.returnedMinor() + o.keptByPropertyMinor() + o.keptBlissFeeMinor()).isEqualTo(60_000);
        }
    }
}
