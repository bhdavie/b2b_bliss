package com.bliss.b2b.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class MerchantGuestFacingNameTest {

    private static Merchant merchant(String businessName, PmsType pms, String enterpriseName) {
        return new Merchant(UUID.randomUUID(), "slug", "a@b.test", businessName, "hotel", null,
                null, null, null, null, null, null, null, null, MerchantStatus.ACTIVE, pms,
                OnboardingState.ACTIVE, Instant.EPOCH, Instant.EPOCH, Instant.EPOCH, null, enterpriseName,
                null, null, null);
    }

    @Test
    void businessNameWins() {
        assertThat(merchant(" Cranberry Trail Inn ", PmsType.MEWS, "Mews Name").guestFacingName())
                .isEqualTo("Cranberry Trail Inn");
    }

    @Test
    void mewsPropertyWithoutANameFallsBackToItsEnterprise() {
        assertThat(merchant("  ", PmsType.MEWS, "Cranberry Trail Inn").guestFacingName())
                .isEqualTo("Cranberry Trail Inn");
    }

    @Test
    void noNameAnywhereIsNull() {
        assertThat(merchant(null, PmsType.MEWS, null).guestFacingName()).isNull();
        // The enterprise name only counts for a property on the Mews rail.
        assertThat(merchant(null, PmsType.CLOUDBEDS, "Stale Mews Name").guestFacingName()).isNull();
    }
}
