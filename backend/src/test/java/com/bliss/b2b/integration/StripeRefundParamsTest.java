package com.bliss.b2b.integration;

import static org.assertj.core.api.Assertions.assertThat;

import com.stripe.param.RefundCreateParams;
import org.junit.jupiter.api.Test;

/** What a cancellation refund asks Stripe for. Bliss keeps its fee. */
class StripeRefundParamsTest {

    @Test
    void aDestinationChargeRefundReversesTheTransferButKeepsBlissFee() {
        RefundCreateParams params = StripePaymentsService.refundParams("pi_dest", 30_000, 30_000, true);

        assertThat(params.getPaymentIntent()).isEqualTo("pi_dest");
        assertThat(params.getAmount()).isEqualTo(30_000L);
        assertThat(params.getReverseTransfer()).isTrue();
        assertThat(params.getRefundApplicationFee()).isFalse();
    }

    @Test
    void aPlatformChargeRefundTouchesNoTransferOrFee() {
        RefundCreateParams params = StripePaymentsService.refundParams("pi_platform", 30_000, 30_000, false);

        assertThat(params.getReverseTransfer()).isNull();
        assertThat(params.getRefundApplicationFee()).isNull();
    }

    @Test
    void neverRefundsMoreThanTheIntentCollected() {
        // The demo charge cap can collect less than the schedule row's amount.
        RefundCreateParams params = StripePaymentsService.refundParams("pi_capped", 30_000, 100, true);

        assertThat(params.getAmount()).isEqualTo(100L);
    }
}
