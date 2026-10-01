package com.bliss.b2b.integration;

import static org.assertj.core.api.Assertions.assertThat;

import com.bliss.b2b.domain.Merchant;
import com.bliss.b2b.domain.MerchantStatus;
import com.bliss.b2b.domain.OnboardingState;
import com.bliss.b2b.domain.PmsType;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * Express accounts let Stripe pull a negative balance from the hotel's bank,
 * so a Bliss fee a hold-mode refund leaves the hotel owing (D9) is recovered.
 */
class StripeExpressAccountParamsTest {

    @Test
    void newExpressAccountsDebitNegativeBalances() {
        Merchant merchant = merchant();

        assertThat(StripeConnectService.createParams(merchant).getSettings().getPayouts().getDebitNegativeBalances())
                .isTrue();
    }

    @Test
    void existingAccountsAreUpdatedToDebitNegativeBalances() {
        assertThat(StripeConnectService.negativeBalanceParams().getSettings().getPayouts()
                .getDebitNegativeBalances()).isTrue();
    }

    private static Merchant merchant() {
        return new Merchant(UUID.randomUUID(), "inn", "owner@inn.test", "Test Inn", "hotel", null,
                null, null, null, null, null, null, null, null, MerchantStatus.ACTIVE, PmsType.MEWS,
                OnboardingState.ACTIVE, Instant.EPOCH, Instant.EPOCH, Instant.EPOCH, null, null,
                null, null, null);
    }
}
