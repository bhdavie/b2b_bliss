package com.bliss.b2b.integration.pms;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.math.BigDecimal;
import org.junit.jupiter.api.Test;

class MewsAdapterMoneyTest {

    @Test
    void grossValueToCentsIsExact() {
        assertThat(MewsAdapter.toMinorUnits(new BigDecimal("2319.0"))).isEqualTo(231_900L);
        assertThat(MewsAdapter.toMinorUnits(new BigDecimal("123.45"))).isEqualTo(12_345L);
        assertThat(MewsAdapter.toMinorUnits(new BigDecimal("0.10"))).isEqualTo(10L);
    }

    @Test
    void fractionsOfACentAreRefusedNotRounded() {
        assertThatThrownBy(() -> MewsAdapter.toMinorUnits(new BigDecimal("10.005")))
                .isInstanceOf(PmsAdapterException.class);
    }
}
