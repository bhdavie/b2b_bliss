package com.bliss.b2b.integration.pms;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import org.junit.jupiter.api.Test;

/** Service check-in/out offsets as services/getAll returns them on the demo enterprises. */
class MewsAdapterDurationTest {

    @Test
    void parsesCheckInAndCheckOutOffsets() {
        assertThat(MewsAdapter.parseDuration("P0M0DT15H0M0S")).isEqualTo(Duration.ofHours(15));
        assertThat(MewsAdapter.parseDuration("P0M0DT12H0M0S")).isEqualTo(Duration.ofHours(12));
    }

    @Test
    void parsesNegativeAndMixedOffsets() {
        assertThat(MewsAdapter.parseDuration("P0M0DT-4H0M0S")).isEqualTo(Duration.ofHours(-4));
        assertThat(MewsAdapter.parseDuration("P0M0DT-12H-15M0S")).isEqualTo(Duration.ofMinutes(-735));
        assertThat(MewsAdapter.parseDuration("P0M1DT2H0M0S")).isEqualTo(Duration.ofHours(26));
    }

    @Test
    void blankIsNull() {
        assertThat(MewsAdapter.parseDuration(null)).isNull();
        assertThat(MewsAdapter.parseDuration("")).isNull();
    }
}
