package com.bliss.b2b.integration.pms;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.math.BigDecimal;
import org.junit.jupiter.api.Test;

class MewsAdapterMoneyTest {

    @Test
    void grossValueToMinorUnitsIsExact() {
        assertThat(MewsAdapter.toMinorUnits(new BigDecimal("2319.0"), "GBP")).isEqualTo(231_900L);
        assertThat(MewsAdapter.toMinorUnits(new BigDecimal("123.45"), "USD")).isEqualTo(12_345L);
        assertThat(MewsAdapter.toMinorUnits(new BigDecimal("0.10"), "EUR")).isEqualTo(10L);
    }

    @Test
    void scaleIsTheCurrencysOwn() {
        // JPY has no minor unit: 12,000 yen is 12000, not 1,200,000.
        assertThat(MewsAdapter.toMinorUnits(new BigDecimal("12000.00"), "JPY")).isEqualTo(12_000L);
        assertThat(MewsAdapter.toGrossValue(12_000L, "JPY")).isEqualByComparingTo("12000");
        // KWD has three decimals.
        assertThat(MewsAdapter.toMinorUnits(new BigDecimal("12.345"), "KWD")).isEqualTo(12_345L);
        assertThat(MewsAdapter.toGrossValue(12_345L, "KWD").toPlainString()).isEqualTo("12.345");
        assertThat(MewsAdapter.toGrossValue(1_050L, "GBP").toPlainString()).isEqualTo("10.50");
    }

    @Test
    void fractionsOfAMinorUnitAreRefusedNotRounded() {
        assertThatThrownBy(() -> MewsAdapter.toMinorUnits(new BigDecimal("10.005"), "GBP"))
                .isInstanceOf(PmsAdapterException.class);
        assertThatThrownBy(() -> MewsAdapter.toMinorUnits(new BigDecimal("100.5"), "JPY"))
                .isInstanceOf(PmsAdapterException.class);
    }

    @Test
    void noCurrencyIsRefused() {
        assertThatThrownBy(() -> MewsAdapter.toGrossValue(100L, null))
                .isInstanceOf(PmsAdapterException.class);
    }
}
