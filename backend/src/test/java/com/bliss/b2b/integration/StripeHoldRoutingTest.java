package com.bliss.b2b.integration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.stripe.param.PaymentIntentCreateParams;
import java.math.BigDecimal;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** How a charge is routed: destination charges for pay as you go, held platform charges for hold mode. */
class StripeHoldRoutingTest {

    private static PaymentIntentCreateParams routed(StripePaymentsService.Destination d) {
        PaymentIntentCreateParams.Builder b = PaymentIntentCreateParams.builder().setAmount(30_000L).setCurrency("usd");
        StripePaymentsService.route(b, d, 30_000L);
        return b.build();
    }

    @Test
    void aHoldModeChargeIsOnBehalfOfThePropertyAndTransfersNothing() {
        UUID booking = UUID.fromString("00000000-0000-0000-0000-00000000b00c");
        PaymentIntentCreateParams p = routed(
                StripePaymentsService.Destination.hold("acct_express", new BigDecimal("0.03"), booking));

        assertThat(p.getOnBehalfOf()).isEqualTo("acct_express");
        assertThat(p.getTransferGroup()).isEqualTo("booking_" + booking);
        assertThat(p.getTransferData()).isNull();
        assertThat(p.getApplicationFeeAmount()).isNull();
    }

    @Test
    void payAsYouGoStaysADestinationChargeWithTheBlissFee() {
        PaymentIntentCreateParams p = routed(
                new StripePaymentsService.Destination("acct_standard", new BigDecimal("0.03")));

        assertThat(p.getTransferData().getDestination()).isEqualTo("acct_standard");
        assertThat(p.getApplicationFeeAmount()).isEqualTo(900L);
        assertThat(p.getOnBehalfOf()).isNull();
    }

    @Test
    void holdModeRefusesToChargeWithoutAnExpressAccount() {
        assertThatThrownBy(() -> StripePaymentsService.Destination.hold(null, null, UUID.randomUUID()))
                .isInstanceOf(IllegalStateException.class);
    }
}
