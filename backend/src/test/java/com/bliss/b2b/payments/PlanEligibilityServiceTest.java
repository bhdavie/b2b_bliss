package com.bliss.b2b.payments;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.LocalDate;
import java.util.List;
import org.junit.jupiter.api.Test;

class PlanEligibilityServiceTest {

    private static final LocalDate TODAY = LocalDate.of(2026, 5, 14);
    private static final long PRICE_CENTS = 400_000L; // $4,000

    private final PlanEligibilityService service = new PlanEligibilityService();

    @Test
    void fiveWeeks_notEligible() {
        EligibilityResult result = service.evaluate(TODAY, TODAY.plusDays(35), PRICE_CENTS);

        assertThat(result.eligible()).isFalse();
        assertThat(result.reason()).isEqualTo("too_close");
        assertThat(result.options()).isEmpty();
        assertThat(result.daysToAppointment()).isEqualTo(35L);
    }

    @Test
    void justUnderSixWeeks_notEligible() {
        // 41 days = 5 weeks 6 days, still in the <6 weeks bucket
        EligibilityResult result = service.evaluate(TODAY, TODAY.plusDays(41), PRICE_CENTS);

        assertThat(result.eligible()).isFalse();
        assertThat(result.options()).isEmpty();
    }

    @Test
    void sixWeeksExact_biweeklyOnly() {
        EligibilityResult result = service.evaluate(TODAY, TODAY.plusDays(42), PRICE_CENTS);

        assertThat(result.eligible()).isTrue();
        assertThat(result.reason()).isEqualTo("ok");
        assertThat(result.options()).hasSize(1);
        PlanOption only = result.options().get(0);
        assertThat(only.frequency()).isEqualTo(PlanFrequency.BIWEEKLY);
        // Final payment must be >= 3 days before appointment:
        // (42 - 3) / 14 = 2 intervals → 3 payments at 0, +14, +28
        assertThat(only.numPayments()).isEqualTo(3);
        assertThat(only.dueDates()).containsExactly(
                TODAY, TODAY.plusDays(14), TODAY.plusDays(28));
    }

    @Test
    void sevenWeeks_biweeklyOnly() {
        EligibilityResult result = service.evaluate(TODAY, TODAY.plusDays(49), PRICE_CENTS);

        assertThat(result.eligible()).isTrue();
        assertThat(result.options())
                .extracting(PlanOption::frequency)
                .containsExactly(PlanFrequency.BIWEEKLY);
        PlanOption biw = result.options().get(0);
        // (49 - 3) / 14 = 3 intervals → 4 payments
        assertThat(biw.numPayments()).isEqualTo(4);
        assertThat(biw.dueDates()).containsExactly(
                TODAY, TODAY.plusDays(14), TODAY.plusDays(28), TODAY.plusDays(42));
    }

    @Test
    void sevenWeeksSixDays_stillBiweeklyOnly() {
        // 55 days = 7 weeks 6 days, last day of the 6-7 week bucket
        EligibilityResult result = service.evaluate(TODAY, TODAY.plusDays(55), PRICE_CENTS);

        assertThat(result.options())
                .extracting(PlanOption::frequency)
                .containsExactly(PlanFrequency.BIWEEKLY);
    }

    @Test
    void eightWeeks_biweeklyAndMonthly() {
        EligibilityResult result = service.evaluate(TODAY, TODAY.plusDays(56), PRICE_CENTS);

        assertThat(result.eligible()).isTrue();
        assertThat(result.options())
                .extracting(PlanOption::frequency)
                .containsExactly(PlanFrequency.BIWEEKLY, PlanFrequency.MONTHLY);

        PlanOption monthly = byFrequency(result.options(), PlanFrequency.MONTHLY);
        // (56 - 3) / 30 = 1 interval → 2 payments at 0, +30
        assertThat(monthly.numPayments()).isEqualTo(2);
        assertThat(monthly.dueDates()).containsExactly(TODAY, TODAY.plusDays(30));
    }

    @Test
    void twelveWeeks_biweeklyAndMonthly() {
        EligibilityResult result = service.evaluate(TODAY, TODAY.plusDays(84), PRICE_CENTS);

        assertThat(result.options())
                .extracting(PlanOption::frequency)
                .containsExactly(PlanFrequency.BIWEEKLY, PlanFrequency.MONTHLY);

        PlanOption biw = byFrequency(result.options(), PlanFrequency.BIWEEKLY);
        // (84 - 3) / 14 = 5 intervals → 6 payments
        assertThat(biw.numPayments()).isEqualTo(6);

        PlanOption monthly = byFrequency(result.options(), PlanFrequency.MONTHLY);
        // (84 - 3) / 30 = 2 intervals → 3 payments at 0, +30, +60
        assertThat(monthly.numPayments()).isEqualTo(3);
        assertThat(monthly.dueDates()).containsExactly(
                TODAY, TODAY.plusDays(30), TODAY.plusDays(60));
    }

    @Test
    void thirteenWeeks_monthlyOnly() {
        EligibilityResult result = service.evaluate(TODAY, TODAY.plusDays(91), PRICE_CENTS);

        assertThat(result.eligible()).isTrue();
        assertThat(result.options())
                .extracting(PlanOption::frequency)
                .containsExactly(PlanFrequency.MONTHLY);
        // (91 - 3) / 30 = 2 intervals → 3 payments
        assertThat(result.options().get(0).numPayments()).isEqualTo(3);
    }

    @Test
    void farFuture_monthlyOnly_manyPayments() {
        // 1 year out
        EligibilityResult result = service.evaluate(TODAY, TODAY.plusDays(365), PRICE_CENTS);

        assertThat(result.options())
                .extracting(PlanOption::frequency)
                .containsExactly(PlanFrequency.MONTHLY);
        // (365 - 3) / 30 = 12 intervals → 13 payments
        assertThat(result.options().get(0).numPayments()).isEqualTo(13);
    }

    @Test
    void evenSplit_amountsAreEqual() {
        // 4 payments at $4,000 = $1,000 each, no remainder
        EligibilityResult result = service.evaluate(TODAY, TODAY.plusDays(49), 400_000L);
        PlanOption only = result.options().get(0);

        assertThat(only.numPayments()).isEqualTo(4);
        assertThat(only.perPaymentAmountCents()).isEqualTo(100_000L);
        assertThat(only.finalPaymentAmountCents()).isEqualTo(100_000L);
        assertSchedulesSumsToTotal(only, 400_000L);
    }

    @Test
    void unevenSplit_remainderOnFinalPayment() {
        // $100.01 (10001 cents) over 3 payments → 3333, 3333, 3335
        EligibilityResult result = service.evaluate(TODAY, TODAY.plusDays(42), 10_001L);
        PlanOption only = result.options().get(0);

        assertThat(only.numPayments()).isEqualTo(3);
        assertThat(only.perPaymentAmountCents()).isEqualTo(3_333L);
        assertThat(only.finalPaymentAmountCents()).isEqualTo(3_335L);
        assertSchedulesSumsToTotal(only, 10_001L);
    }

    @Test
    void sameDayAppointment_notEligible() {
        EligibilityResult result = service.evaluate(TODAY, TODAY, PRICE_CENTS);

        assertThat(result.eligible()).isFalse();
        assertThat(result.daysToAppointment()).isEqualTo(0L);
    }

    private static PlanOption byFrequency(List<PlanOption> options, PlanFrequency frequency) {
        return options.stream()
                .filter(o -> o.frequency() == frequency)
                .findFirst()
                .orElseThrow();
    }

    private static void assertSchedulesSumsToTotal(PlanOption option, long expectedTotalCents) {
        long sum = (long) (option.numPayments() - 1) * option.perPaymentAmountCents()
                + option.finalPaymentAmountCents();
        assertThat(sum).isEqualTo(expectedTotalCents);
    }
}
