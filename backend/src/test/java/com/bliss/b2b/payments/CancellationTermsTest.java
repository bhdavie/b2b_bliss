package com.bliss.b2b.payments;

import static org.assertj.core.api.Assertions.assertThat;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.ZoneId;
import java.util.List;
import org.junit.jupiter.api.Test;

/** Mews cancellation policies, read the way Bliss uses them. */
class CancellationTermsTest {

    private static final ZoneId LONDON = ZoneId.of("Europe/London");
    private static final Instant CREATED = Instant.parse("2026-10-01T10:00:00Z");
    private static final Instant START = Instant.parse("2027-03-15T15:00:00Z");

    private static CancellationTerms.Step step(String applicability, String offset, String extent,
            String relative, Integer maxUnits) {
        return new CancellationTerms.Step(applicability, offset, extent,
                relative == null ? null : new BigDecimal(relative), null, null, maxUnits);
    }

    @Test
    void noPolicyIsFreeCancellationUntilArrival() {
        CancellationTerms terms = CancellationTerms.freeUntilArrival();

        assertThat(terms.derivedType()).isEqualTo(BookingType.REFUNDABLE);
        assertThat(terms.freeCancellationUntil(CREATED, START, LONDON)).isEqualTo(START);
        assertThat(terms.describe()).isEqualTo("Free cancellation until arrival");
    }

    @Test
    void theWholeStayChargedFromBookingIsNonRefundable() {
        // The shape Mews returns, offset written with a date part.
        CancellationTerms terms = new CancellationTerms(List.of(
                step("Creation", "P0M0DT0H0M0S", "TimeUnits", "1", null)));

        assertThat(terms.derivedType()).isEqualTo(BookingType.NON_REFUNDABLE);
        assertThat(terms.freeCancellationUntil(CREATED, START, LONDON)).isEqualTo(CREATED);
        assertThat(terms.describe()).isEqualTo("Non-refundable");
    }

    @Test
    void aPartialPenaltyFromBookingIsStillRefundable() {
        // Captured from the Gross UK demo: 50% of nights from creation.
        CancellationTerms terms = new CancellationTerms(List.of(
                step("Creation", "P0M0DT0H0M0S", "TimeUnits", "0.5", null)));

        assertThat(terms.derivedType()).isEqualTo(BookingType.REFUNDABLE);
        assertThat(terms.describe()).isEqualTo("A cancellation fee applies from booking");
    }

    @Test
    void aFeeCappedAtOneNightIsRefundable() {
        CancellationTerms terms = new CancellationTerms(List.of(
                step("Creation", "P0M0DT0H0M0S", "TimeUnits", "1", 1)));

        assertThat(terms.derivedType()).isEqualTo(BookingType.REFUNDABLE);
    }

    @Test
    void aWindowBeforeArrivalSetsTheDeadline() {
        CancellationTerms terms = new CancellationTerms(List.of(
                step("Start", "P0M14DT0H0M0S", "TimeUnits", "1", null)));

        assertThat(terms.derivedType()).isEqualTo(BookingType.REFUNDABLE);
        assertThat(terms.freeCancellationUntil(CREATED, START, LONDON))
                .isEqualTo(Instant.parse("2027-03-01T15:00:00Z"));
        assertThat(terms.describe()).isEqualTo("Free cancellation until 14 days before arrival");
    }

    @Test
    void startDateCountsBackFromMidnightOfTheArrivalDayInThePropertysZone() {
        // 48 hours before the start of 15 March in London, which is GMT then.
        CancellationTerms terms = new CancellationTerms(List.of(
                step("StartDate", "P0M0DT48H0M0S", "TimeUnits", "1", null)));

        assertThat(terms.freeCancellationUntil(CREATED, START, LONDON))
                .isEqualTo(Instant.parse("2027-03-13T00:00:00Z"));
        assertThat(terms.describe()).isEqualTo("Free cancellation until 2 days before arrival");
    }

    @Test
    void theEarliestStepDecides() {
        CancellationTerms terms = new CancellationTerms(List.of(
                step("Start", "P7D", "TimeUnits", "1", null),
                step("Start", "P30D", "TimeUnits", "0.5", null)));

        assertThat(terms.freeCancellationUntil(CREATED, START, LONDON))
                .isEqualTo(Instant.parse("2027-02-13T15:00:00Z"));
        assertThat(terms.describe()).isEqualTo("Free cancellation until 30 days before arrival");
    }

    @Test
    void aGracePeriodAfterBookingIsDescribedAsSuch() {
        CancellationTerms terms = new CancellationTerms(List.of(
                step("Creation", "P2D", "TimeUnits", "1", null)));

        assertThat(terms.derivedType()).isEqualTo(BookingType.REFUNDABLE);
        assertThat(terms.freeCancellationUntil(CREATED, START, LONDON))
                .isEqualTo(Instant.parse("2026-10-03T10:00:00Z"));
        assertThat(terms.describe()).isEqualTo("Free cancellation for 2 days after booking");
    }

    @Test
    void noPenaltyBeforeAStepApplies_thePolicyFeeAfter() {
        // 50% of the stay from 7 days before arrival.
        CancellationTerms t = new CancellationTerms(List.of(step("Start", "P0M7DT0H0M0S", "TimeUnits", "0.5", null)));

        assertThat(t.penaltyAt(Instant.parse("2027-03-01T00:00:00Z"), CREATED, START, LONDON, 120_000, 3, "GBP"))
                .isZero();
        assertThat(t.penaltyAt(Instant.parse("2027-03-10T00:00:00Z"), CREATED, START, LONDON, 120_000, 3, "GBP"))
                .isEqualTo(60_000);
    }

    @Test
    void aFeeCappedAtOneNightChargesOneNightsShareOfTheStay() {
        CancellationTerms t = new CancellationTerms(List.of(step("Start", "P0M2DT0H0M0S", "TimeUnits", "1", 1)));

        assertThat(t.penaltyAt(Instant.parse("2027-03-14T12:00:00Z"), CREATED, START, LONDON, 120_000, 3, "GBP"))
                .isEqualTo(40_000);
    }

    @Test
    void theLargestApplyingStepWins_andAnAbsoluteFeeCountsInItsOwnCurrency() {
        CancellationTerms t = new CancellationTerms(List.of(
                step("Creation", "P0M0DT0H0M0S", "TimeUnits", "0.1", null),
                new CancellationTerms.Step("Creation", "P0M0DT0H0M0S", "Nothing", null, 25_000L, "GBP", null),
                new CancellationTerms.Step("Creation", "P0M0DT0H0M0S", "Nothing", null, 99_000L, "EUR", null)));

        assertThat(t.penaltyAt(Instant.parse("2026-10-02T00:00:00Z"), CREATED, START, LONDON, 120_000, 3, "GBP"))
                .isEqualTo(25_000);
    }

    @Test
    void noPolicyNeverCharges() {
        assertThat(CancellationTerms.freeUntilArrival().penaltyAt(START.plusSeconds(3600), CREATED, START, LONDON,
                120_000, 3, "GBP")).isZero();
    }
}
