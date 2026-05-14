package com.bliss.b2b.payments;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.LocalDate;
import java.util.List;
import org.junit.jupiter.api.Test;

class PlanEligibilityServiceTest {

    private static final LocalDate TODAY = LocalDate.of(2026, 5, 14);
    private static final long PRICE_CENTS = 400_000L; // $4,000

    private final PlanEligibilityService service = new PlanEligibilityService();

    // -- Default rules: 6w minimum, both frequencies allowed, no amount caps, no deposit --

    @Test
    void defaults_fiveWeeks_notEligible() {
        EligibilityResult result = service.evaluate(
                TODAY, TODAY.plusDays(35), PRICE_CENTS, MerchantPlanRules.DEFAULTS);

        assertThat(result.eligible()).isFalse();
        assertThat(result.reason()).isEqualTo("too_close");
        assertThat(result.options()).isEmpty();
        assertThat(result.daysToAppointment()).isEqualTo(35L);
        assertThat(result.depositAmountCents()).isZero();
    }

    @Test
    void defaults_justUnderSixWeeks_notEligible() {
        EligibilityResult result = service.evaluate(
                TODAY, TODAY.plusDays(41), PRICE_CENTS, MerchantPlanRules.DEFAULTS);

        assertThat(result.eligible()).isFalse();
        assertThat(result.reason()).isEqualTo("too_close");
    }

    @Test
    void defaults_sixWeeksExact_bothFrequenciesFit() {
        EligibilityResult result = service.evaluate(
                TODAY, TODAY.plusDays(42), PRICE_CENTS, MerchantPlanRules.DEFAULTS);

        assertThat(result.eligible()).isTrue();
        assertThat(result.depositAmountCents()).isZero();
        assertThat(result.options())
                .extracting(PlanOption::frequency)
                .containsExactly(PlanFrequency.BIWEEKLY, PlanFrequency.MONTHLY);

        PlanOption biw = byFrequency(result.options(), PlanFrequency.BIWEEKLY);
        assertThat(biw.numPayments()).isEqualTo(3);
        PlanOption monthly = byFrequency(result.options(), PlanFrequency.MONTHLY);
        // (42 - 3) / 30 = 1 interval → 2 payments at 0, +30
        assertThat(monthly.numPayments()).isEqualTo(2);
    }

    @Test
    void defaults_thirteenWeeks_bothFrequenciesFit() {
        EligibilityResult result = service.evaluate(
                TODAY, TODAY.plusDays(91), PRICE_CENTS, MerchantPlanRules.DEFAULTS);

        assertThat(result.eligible()).isTrue();
        assertThat(result.options())
                .extracting(PlanOption::frequency)
                .containsExactly(PlanFrequency.BIWEEKLY, PlanFrequency.MONTHLY);
    }

    @Test
    void defaults_sameDayAppointment_notEligible() {
        EligibilityResult result = service.evaluate(
                TODAY, TODAY, PRICE_CENTS, MerchantPlanRules.DEFAULTS);

        assertThat(result.eligible()).isFalse();
        assertThat(result.reason()).isEqualTo("too_close");
        assertThat(result.daysToAppointment()).isEqualTo(0L);
    }

    // -- Custom minimum lead time --

    @Test
    void customMinLead_eightWeeks_blocksAtSevenWeeks() {
        MerchantPlanRules tighter = noDeposit(8, null, AllowedFrequencies.BOTH, null, null, null);

        EligibilityResult result = service.evaluate(
                TODAY, TODAY.plusDays(49), PRICE_CENTS, tighter); // 7w

        assertThat(result.eligible()).isFalse();
        assertThat(result.reason()).isEqualTo("too_close");
    }

    @Test
    void customMinLead_fourWeeks_allowsFiveWeeks() {
        MerchantPlanRules looser = noDeposit(4, null, AllowedFrequencies.BOTH, null, null, null);

        EligibilityResult result = service.evaluate(
                TODAY, TODAY.plusDays(35), PRICE_CENTS, looser); // 5w

        assertThat(result.eligible()).isTrue();
        assertThat(result.options())
                .extracting(PlanOption::frequency)
                .containsExactly(PlanFrequency.BIWEEKLY, PlanFrequency.MONTHLY);
    }

    // -- Maximum lead time --

    @Test
    void maxLead_blocksFarFutureBookings() {
        MerchantPlanRules capped = noDeposit(6, 16, AllowedFrequencies.BOTH, null, null, null);

        EligibilityResult result = service.evaluate(
                TODAY, TODAY.plusDays(140), PRICE_CENTS, capped); // 20w

        assertThat(result.eligible()).isFalse();
        assertThat(result.reason()).isEqualTo("too_far");
    }

    @Test
    void maxLead_exactBoundary_allowed() {
        MerchantPlanRules capped = noDeposit(6, 16, AllowedFrequencies.BOTH, null, null, null);

        EligibilityResult result = service.evaluate(
                TODAY, TODAY.plusDays(112), PRICE_CENTS, capped); // exactly 16w

        assertThat(result.eligible()).isTrue();
    }

    // -- Allowed frequencies --

    @Test
    void monthlyOnly_neverShowsBiweekly() {
        MerchantPlanRules monthlyOnly = noDeposit(6, null, AllowedFrequencies.MONTHLY, null, null, null);

        EligibilityResult result = service.evaluate(
                TODAY, TODAY.plusDays(70), PRICE_CENTS, monthlyOnly);

        assertThat(result.options())
                .extracting(PlanOption::frequency)
                .containsExactly(PlanFrequency.MONTHLY);
    }

    @Test
    void biweeklyOnly_atSixWeeks_neverShowsMonthly() {
        MerchantPlanRules biwOnly = noDeposit(6, null, AllowedFrequencies.BIWEEKLY, null, null, null);

        EligibilityResult result = service.evaluate(
                TODAY, TODAY.plusDays(42), PRICE_CENTS, biwOnly);

        assertThat(result.options())
                .extracting(PlanOption::frequency)
                .containsExactly(PlanFrequency.BIWEEKLY);
    }

    @Test
    void monthlyOnly_atFourWeeks_returnsNoPlanFits() {
        MerchantPlanRules monthlyOnly = noDeposit(4, null, AllowedFrequencies.MONTHLY, null, null, null);

        EligibilityResult result = service.evaluate(
                TODAY, TODAY.plusDays(28), PRICE_CENTS, monthlyOnly);

        assertThat(result.eligible()).isFalse();
        assertThat(result.reason()).isEqualTo("no_plan_fits");
        assertThat(result.options()).isEmpty();
    }

    // -- Amount limits --

    @Test
    void minAmount_belowLimit_rejected() {
        MerchantPlanRules withFloor = noDeposit(6, null, AllowedFrequencies.BOTH, 100_000L, null, null);

        EligibilityResult result = service.evaluate(
                TODAY, TODAY.plusDays(70), 50_000L, withFloor);

        assertThat(result.eligible()).isFalse();
        assertThat(result.reason()).isEqualTo("amount_too_low");
    }

    @Test
    void minAmount_exactBoundary_allowed() {
        MerchantPlanRules withFloor = noDeposit(6, null, AllowedFrequencies.BOTH, 100_000L, null, null);

        EligibilityResult result = service.evaluate(
                TODAY, TODAY.plusDays(70), 100_000L, withFloor);

        assertThat(result.eligible()).isTrue();
    }

    @Test
    void maxAmount_aboveLimit_rejected() {
        MerchantPlanRules withCap = noDeposit(6, null, AllowedFrequencies.BOTH, null, 500_000L, null);

        EligibilityResult result = service.evaluate(
                TODAY, TODAY.plusDays(70), 600_000L, withCap);

        assertThat(result.eligible()).isFalse();
        assertThat(result.reason()).isEqualTo("amount_too_high");
    }

    @Test
    void amountRangeOrder_minCheckedBeforeMax() {
        MerchantPlanRules ranged = noDeposit(6, null, AllowedFrequencies.BOTH, 100_000L, 500_000L, null);

        EligibilityResult result = service.evaluate(
                TODAY, TODAY.plusDays(70), 50_000L, ranged);

        assertThat(result.reason()).isEqualTo("amount_too_low");
    }

    @Test
    void amountLimits_appliedToTotal_notPostDepositBalance() {
        // $1k floor, 50% deposit. Booking of $800: total $800 < $1k -> reject.
        // The post-deposit balance would only be $400 anyway, but the rule
        // explicitly applies to the booking total, not the installment principal.
        MerchantPlanRules withFloor = withDeposit(
                6, null, AllowedFrequencies.BOTH, 100_000L, null, null,
                DepositType.PERCENTAGE, 50L, null);

        EligibilityResult result = service.evaluate(
                TODAY, TODAY.plusDays(70), 80_000L, withFloor);

        assertThat(result.eligible()).isFalse();
        assertThat(result.reason()).isEqualTo("amount_too_low");
    }

    // -- Recommended frequency --

    @Test
    void recommended_defaultsToMonthly_whenBoth() {
        assertThat(MerchantPlanRules.DEFAULTS.resolveRecommended())
                .isEqualTo(PlanFrequency.MONTHLY);
    }

    @Test
    void recommended_explicitBiweekly_overrides() {
        MerchantPlanRules pickBiw = noDeposit(
                6, null, AllowedFrequencies.BOTH, null, null, PlanFrequency.BIWEEKLY);

        assertThat(pickBiw.resolveRecommended()).isEqualTo(PlanFrequency.BIWEEKLY);
    }

    @Test
    void recommended_singleOption_returnsNull() {
        MerchantPlanRules monthlyOnly = noDeposit(
                6, null, AllowedFrequencies.MONTHLY, null, null, null);

        assertThat(monthlyOnly.resolveRecommended()).isNull();
    }

    // -- Cent splitting (no deposit) --

    @Test
    void evenSplit_amountsAreEqual_noDeposit() {
        EligibilityResult result = service.evaluate(
                TODAY, TODAY.plusDays(49), 400_000L, MerchantPlanRules.DEFAULTS);
        PlanOption biw = byFrequency(result.options(), PlanFrequency.BIWEEKLY);

        assertThat(biw.numPayments()).isEqualTo(4);
        assertThat(biw.perPaymentAmountCents()).isEqualTo(100_000L);
        assertThat(biw.finalPaymentAmountCents()).isEqualTo(100_000L);
        assertSchedulesSumsToTotal(biw, 400_000L);
    }

    @Test
    void unevenSplit_remainderOnFinalPayment_noDeposit() {
        MerchantPlanRules biwOnly = noDeposit(6, null, AllowedFrequencies.BIWEEKLY, null, null, null);

        EligibilityResult result = service.evaluate(
                TODAY, TODAY.plusDays(42), 10_001L, biwOnly);
        PlanOption only = result.options().get(0);

        assertThat(only.numPayments()).isEqualTo(3);
        assertThat(only.perPaymentAmountCents()).isEqualTo(3_333L);
        assertThat(only.finalPaymentAmountCents()).isEqualTo(3_335L);
        assertSchedulesSumsToTotal(only, 10_001L);
    }

    // -- Deposits (Phase 9) --

    @Test
    void depositRequired_percentage_carvesOutDepositAndDividesRemainder() {
        // The hotel example: $800, 2 months out, 25% deposit, monthly.
        // Total 800, deposit 200, remainder 600 over installments.
        MerchantPlanRules rules = withDeposit(
                6, null, AllowedFrequencies.MONTHLY, null, null, null,
                DepositType.PERCENTAGE, 25L, null);

        EligibilityResult result = service.evaluate(
                TODAY, TODAY.plusDays(63), 80_000L, rules); // 9w out gives room for 2 monthly installments

        assertThat(result.eligible()).isTrue();
        assertThat(result.depositAmountCents()).isEqualTo(20_000L);
        PlanOption monthly = result.options().get(0);
        assertThat(monthly.numPayments()).isEqualTo(2);
        assertThat(monthly.perPaymentAmountCents()).isEqualTo(30_000L);
        assertThat(monthly.finalPaymentAmountCents()).isEqualTo(30_000L);
        // First installment is at day F (one cadence interval after today),
        // not day 0 — the deposit holds day 0.
        assertThat(monthly.dueDates().get(0)).isEqualTo(TODAY.plusDays(30));
        assertThat(monthly.dueDates().get(1)).isEqualTo(TODAY.plusDays(60));
    }

    @Test
    void depositRequired_fixed_capsAtBookingTotal() {
        MerchantPlanRules rules = withDeposit(
                6, null, AllowedFrequencies.BOTH, null, null, null,
                DepositType.FIXED, 5_000L, null); // $50 fixed deposit

        // Booking of $40 — the fixed deposit equals the total, which would
        // leave zero for installments. Reject as deposit_too_high.
        EligibilityResult result = service.evaluate(
                TODAY, TODAY.plusDays(70), 4_000L, rules);

        assertThat(result.eligible()).isFalse();
        assertThat(result.reason()).isEqualTo("deposit_too_high");
        assertThat(result.depositAmountCents()).isEqualTo(4_000L);
    }

    @Test
    void depositMaxCents_capsLargePercentageDeposits() {
        // 25% deposit on $10,000 would be $2,500 — but the merchant capped
        // their deposit at $500 to keep upfront friction low. Final deposit
        // is $500; remainder $9,500 divides into installments.
        MerchantPlanRules rules = withDeposit(
                6, null, AllowedFrequencies.MONTHLY, null, null, null,
                DepositType.PERCENTAGE, 25L, 50_000L);

        EligibilityResult result = service.evaluate(
                TODAY, TODAY.plusDays(91), 1_000_000L, rules); // 13w

        assertThat(result.eligible()).isTrue();
        assertThat(result.depositAmountCents()).isEqualTo(50_000L);
        PlanOption monthly = result.options().get(0);
        // (91 - 3) / 30 = 2 intervals, with deposit so numPayments = 2
        assertThat(monthly.numPayments()).isEqualTo(2);
        // $9,500 / 2 = $4,750 each
        assertThat(monthly.perPaymentAmountCents()).isEqualTo(475_000L);
        assertThat(monthly.finalPaymentAmountCents()).isEqualTo(475_000L);
    }

    @Test
    void depositRequired_fixedSmallerThanTotal_dividesRemainder() {
        // $200 fixed deposit on $800 booking → $200 today, $600 / N installments
        MerchantPlanRules rules = withDeposit(
                6, null, AllowedFrequencies.MONTHLY, null, null, null,
                DepositType.FIXED, 20_000L, null);

        EligibilityResult result = service.evaluate(
                TODAY, TODAY.plusDays(63), 80_000L, rules); // 9w monthly fits 2 installments

        assertThat(result.eligible()).isTrue();
        assertThat(result.depositAmountCents()).isEqualTo(20_000L);
        PlanOption monthly = result.options().get(0);
        assertThat(monthly.numPayments()).isEqualTo(2);
        assertSchedulesSumsToTotal(monthly, 60_000L);
    }

    @Test
    void depositWithUnevenInstallmentSplit_remainderOnFinalInstallment() {
        // $1000 total, $100 fixed deposit → $900 over 3 installments.
        // 900 / 3 = 300 each, no remainder.
        // Switch to total $1001 → deposit $100, remainder $901 / 3 = 300, 300, 301.
        MerchantPlanRules rules = withDeposit(
                6, null, AllowedFrequencies.BIWEEKLY, null, null, null,
                DepositType.FIXED, 10_000L, null);

        EligibilityResult result = service.evaluate(
                TODAY, TODAY.plusDays(49), 100_101L, rules); // 7w biweekly fits 3 installments

        assertThat(result.eligible()).isTrue();
        assertThat(result.depositAmountCents()).isEqualTo(10_000L);
        PlanOption biw = result.options().get(0);
        // Installment total = 100101 - 10000 = 90101. 90101 / 3 = 30033 r 2.
        assertThat(biw.numPayments()).isEqualTo(3);
        assertThat(biw.perPaymentAmountCents()).isEqualTo(30_033L);
        assertThat(biw.finalPaymentAmountCents()).isEqualTo(30_035L);
        assertSchedulesSumsToTotal(biw, 90_101L);
    }

    @Test
    void depositPresent_atSixWeeksMonthly_fitsOneInstallment() {
        // 6 weeks (42 days) + monthly + deposit: with the deposit pushing
        // the first installment to day 30, intervals = (42-3)/30 = 1, so
        // 1 installment. Allowed because deposit + 1 installment is a plan.
        MerchantPlanRules rules = withDeposit(
                6, null, AllowedFrequencies.MONTHLY, null, null, null,
                DepositType.PERCENTAGE, 25L, null);

        EligibilityResult result = service.evaluate(
                TODAY, TODAY.plusDays(42), 80_000L, rules);

        assertThat(result.eligible()).isTrue();
        assertThat(result.depositAmountCents()).isEqualTo(20_000L);
        PlanOption monthly = result.options().get(0);
        assertThat(monthly.numPayments()).isEqualTo(1);
        assertThat(monthly.perPaymentAmountCents()).isEqualTo(60_000L);
        assertThat(monthly.dueDates()).containsExactly(TODAY.plusDays(30));
    }

    @Test
    void computeDeposit_percentageRoundsDown() {
        MerchantPlanRules rules = withDeposit(
                6, null, AllowedFrequencies.BOTH, null, null, null,
                DepositType.PERCENTAGE, 33L, null);

        // 33% of $10.00 = $3.30 (33000 * 33 / 100 = 990 cents flat → no rounding here)
        assertThat(rules.computeDepositCents(1_000L)).isEqualTo(330L);
        // 33% of $9.99 = 999 * 33 / 100 = 329 cents (rounds down)
        assertThat(rules.computeDepositCents(999L)).isEqualTo(329L);
    }

    @Test
    void computeDeposit_disabled_returnsZero() {
        assertThat(MerchantPlanRules.DEFAULTS.computeDepositCents(100_000L)).isZero();
    }

    // -- helpers --

    private static MerchantPlanRules noDeposit(
            int minLead, Integer maxLead, AllowedFrequencies freqs,
            Long minAmt, Long maxAmt, PlanFrequency rec
    ) {
        return new MerchantPlanRules(minLead, maxLead, freqs, minAmt, maxAmt, rec,
                false, null, null, null);
    }

    private static MerchantPlanRules withDeposit(
            int minLead, Integer maxLead, AllowedFrequencies freqs,
            Long minAmt, Long maxAmt, PlanFrequency rec,
            DepositType depositType, Long depositValue, Long depositMaxCents
    ) {
        return new MerchantPlanRules(minLead, maxLead, freqs, minAmt, maxAmt, rec,
                true, depositType, depositValue, depositMaxCents);
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
