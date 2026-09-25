package com.bliss.b2b.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.bliss.b2b.payments.AfterRetriesAction;
import com.bliss.b2b.payments.AllowedFrequencies;
import com.bliss.b2b.payments.MerchantPlanRules;
import com.bliss.b2b.payments.PaymentDuePolicy;
import com.bliss.b2b.payments.RefundPolicy;
import java.util.List;
import org.junit.jupiter.api.Test;

/** The future-stay credit a cancelled Mews stay earns, per refund policy. */
class CancellationCreditTest {

    private static MerchantPlanRules rules(RefundPolicy policy) {
        return new MerchantPlanRules(
                6, null, AllowedFrequencies.BOTH, null, null, null,
                false, null, null, null,
                policy, null,
                false, null, null, null,
                PaymentDuePolicy.AT_APPOINTMENT, null,
                3, 3,
                false, null, null, null,
                AfterRetriesAction.TREAT_AS_CANCELLATION, 0, List.of());
    }

    @Test
    void fullPolicyCreditsWhatThePolicyWouldRefund() {
        assertThat(CancellationService.creditFor(rules(RefundPolicy.FULL), 80_000, 80_000, 0)).isEqualTo(80_000);
    }

    @Test
    void creditOnlyCreditsEverythingPaidEvenThoughItRefundsNothing() {
        assertThat(CancellationService.creditFor(rules(RefundPolicy.CREDIT_ONLY), 80_000, 0, 0)).isEqualTo(80_000);
    }

    @Test
    void cancellationFeeComesOffTheCreditAndNeverGoesNegative() {
        assertThat(CancellationService.creditFor(rules(RefundPolicy.FULL), 80_000, 80_000, 10_000)).isEqualTo(70_000);
        assertThat(CancellationService.creditFor(rules(RefundPolicy.CREDIT_ONLY), 5_000, 0, 10_000)).isZero();
    }

    @Test
    void noRefundPolicyMeansNoCredit() {
        assertThat(CancellationService.creditFor(rules(RefundPolicy.NONE), 80_000, 0, 0)).isZero();
    }
}
