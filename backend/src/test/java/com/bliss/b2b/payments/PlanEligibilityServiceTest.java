package com.bliss.b2b.payments;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.LocalDate;
import java.util.List;
import org.junit.jupiter.api.Test;

class PlanEligibilityServiceTest {

    private static final LocalDate TODAY = LocalDate.of(2026, 5, 14);
    private static final long PRICE_CENTS = 400_000L; // $4,000

    private final PlanEligibilityService service = new PlanEligibilityService();

    // -- Default rules: 6w minimum, both frequencies allowed, no amount caps --

    @Test
    void defaults_fiveWeeks_notEligible() {
        EligibilityResult result = service.evaluate(
                TODAY, TODAY.plusDays(35), PRICE_CENTS, MerchantPlanRules.DEFAULTS);

        assertThat(result.eligible()).isFalse();
        assertThat(result.reason()).isEqualTo("too_close");
        assertThat(result.options()).isEmpty();
        assertThat(result.daysToAppointment()).isEqualTo(35L);
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
        // Default behavior under Phase 8: rules dictate which frequencies are
        // offered, not the lead time. Both math-fits at 13w → both shown.
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
        MerchantPlanRules tighter = new MerchantPlanRules(
                8, null, AllowedFrequencies.BOTH, null, null, null);

        EligibilityResult result = service.evaluate(
                TODAY, TODAY.plusDays(49), PRICE_CENTS, tighter); // 7w

        assertThat(result.eligible()).isFalse();
        assertThat(result.reason()).isEqualTo("too_close");
    }

    @Test
    void customMinLead_fourWeeks_allowsFiveWeeks() {
        MerchantPlanRules looser = new MerchantPlanRules(
                4, null, AllowedFrequencies.BOTH, null, null, null);

        EligibilityResult result = service.evaluate(
                TODAY, TODAY.plusDays(35), PRICE_CENTS, looser); // 5w

        assertThat(result.eligible()).isTrue();
        // 5w biweekly: (35-3)/14 = 2 → 3 pmts. Monthly: (35-3)/30 = 1 → 2 pmts.
        assertThat(result.options())
                .extracting(PlanOption::frequency)
                .containsExactly(PlanFrequency.BIWEEKLY, PlanFrequency.MONTHLY);
    }

    // -- Maximum lead time --

    @Test
    void maxLead_blocksFarFutureBookings() {
        MerchantPlanRules capped = new MerchantPlanRules(
                6, 16, AllowedFrequencies.BOTH, null, null, null);

        // 20 weeks out — beyond cap
        EligibilityResult result = service.evaluate(
                TODAY, TODAY.plusDays(140), PRICE_CENTS, capped);

        assertThat(result.eligible()).isFalse();
        assertThat(result.reason()).isEqualTo("too_far");
    }

    @Test
    void maxLead_exactBoundary_allowed() {
        MerchantPlanRules capped = new MerchantPlanRules(
                6, 16, AllowedFrequencies.BOTH, null, null, null);

        // Exactly 16 weeks
        EligibilityResult result = service.evaluate(
                TODAY, TODAY.plusDays(112), PRICE_CENTS, capped);

        assertThat(result.eligible()).isTrue();
    }

    // -- Allowed frequencies --

    @Test
    void monthlyOnly_neverShowsBiweekly() {
        MerchantPlanRules monthlyOnly = new MerchantPlanRules(
                6, null, AllowedFrequencies.MONTHLY, null, null, null);

        EligibilityResult result = service.evaluate(
                TODAY, TODAY.plusDays(70), PRICE_CENTS, monthlyOnly); // 10w

        assertThat(result.options())
                .extracting(PlanOption::frequency)
                .containsExactly(PlanFrequency.MONTHLY);
    }

    @Test
    void biweeklyOnly_atSixWeeks_neverShowsMonthly() {
        MerchantPlanRules biwOnly = new MerchantPlanRules(
                6, null, AllowedFrequencies.BIWEEKLY, null, null, null);

        EligibilityResult result = service.evaluate(
                TODAY, TODAY.plusDays(42), PRICE_CENTS, biwOnly);

        assertThat(result.options())
                .extracting(PlanOption::frequency)
                .containsExactly(PlanFrequency.BIWEEKLY);
    }

    @Test
    void monthlyOnly_atFiveWeeksWithLooserLead_returnsNoPlanFits() {
        // Merchant allows monthly only, lowers lead time to 4 weeks. Customer
        // books 4 weeks out (28 days). (28 - 3) / 30 = 0 intervals → 1 pmt,
        // which is below the 2-payment minimum. No frequency fits.
        MerchantPlanRules monthlyOnly = new MerchantPlanRules(
                4, null, AllowedFrequencies.MONTHLY, null, null, null);

        EligibilityResult result = service.evaluate(
                TODAY, TODAY.plusDays(28), PRICE_CENTS, monthlyOnly);

        assertThat(result.eligible()).isFalse();
        assertThat(result.reason()).isEqualTo("no_plan_fits");
        assertThat(result.options()).isEmpty();
    }

    // -- Amount limits --

    @Test
    void minAmount_belowLimit_rejected() {
        MerchantPlanRules withFloor = new MerchantPlanRules(
                6, null, AllowedFrequencies.BOTH, 100_000L, null, null); // $1,000 floor

        EligibilityResult result = service.evaluate(
                TODAY, TODAY.plusDays(70), 50_000L, withFloor); // $500 booking

        assertThat(result.eligible()).isFalse();
        assertThat(result.reason()).isEqualTo("amount_too_low");
    }

    @Test
    void minAmount_exactBoundary_allowed() {
        MerchantPlanRules withFloor = new MerchantPlanRules(
                6, null, AllowedFrequencies.BOTH, 100_000L, null, null);

        EligibilityResult result = service.evaluate(
                TODAY, TODAY.plusDays(70), 100_000L, withFloor);

        assertThat(result.eligible()).isTrue();
    }

    @Test
    void maxAmount_aboveLimit_rejected() {
        MerchantPlanRules withCap = new MerchantPlanRules(
                6, null, AllowedFrequencies.BOTH, null, 500_000L, null); // $5,000 cap

        EligibilityResult result = service.evaluate(
                TODAY, TODAY.plusDays(70), 600_000L, withCap); // $6,000 booking

        assertThat(result.eligible()).isFalse();
        assertThat(result.reason()).isEqualTo("amount_too_high");
    }

    @Test
    void amountRangeOrder_minCheckedBeforeMax() {
        // Floor $1k, cap $5k, booking $500 → reports amount_too_low.
        MerchantPlanRules ranged = new MerchantPlanRules(
                6, null, AllowedFrequencies.BOTH, 100_000L, 500_000L, null);

        EligibilityResult result = service.evaluate(
                TODAY, TODAY.plusDays(70), 50_000L, ranged);

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
        MerchantPlanRules pickBiw = new MerchantPlanRules(
                6, null, AllowedFrequencies.BOTH, null, null, PlanFrequency.BIWEEKLY);

        assertThat(pickBiw.resolveRecommended()).isEqualTo(PlanFrequency.BIWEEKLY);
    }

    @Test
    void recommended_singleOption_returnsNull() {
        MerchantPlanRules monthlyOnly = new MerchantPlanRules(
                6, null, AllowedFrequencies.MONTHLY, null, null, null);

        // No "recommended" badge when only one frequency is offered.
        assertThat(monthlyOnly.resolveRecommended()).isNull();
    }

    // -- Cent splitting (unchanged from earlier phases) --

    @Test
    void evenSplit_amountsAreEqual() {
        EligibilityResult result = service.evaluate(
                TODAY, TODAY.plusDays(49), 400_000L, MerchantPlanRules.DEFAULTS);
        PlanOption biw = byFrequency(result.options(), PlanFrequency.BIWEEKLY);

        assertThat(biw.numPayments()).isEqualTo(4);
        assertThat(biw.perPaymentAmountCents()).isEqualTo(100_000L);
        assertThat(biw.finalPaymentAmountCents()).isEqualTo(100_000L);
        assertSchedulesSumsToTotal(biw, 400_000L);
    }

    @Test
    void unevenSplit_remainderOnFinalPayment() {
        MerchantPlanRules biwOnly = new MerchantPlanRules(
                6, null, AllowedFrequencies.BIWEEKLY, null, null, null);

        // $100.01 over 3 biweekly payments → 3333, 3333, 3335
        EligibilityResult result = service.evaluate(
                TODAY, TODAY.plusDays(42), 10_001L, biwOnly);
        PlanOption only = result.options().get(0);

        assertThat(only.numPayments()).isEqualTo(3);
        assertThat(only.perPaymentAmountCents()).isEqualTo(3_333L);
        assertThat(only.finalPaymentAmountCents()).isEqualTo(3_335L);
        assertSchedulesSumsToTotal(only, 10_001L);
    }

    // -- helpers --

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
