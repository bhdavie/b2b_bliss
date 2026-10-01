package com.bliss.b2b.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class MewsConnectionAllowlistTest {

    private static MewsConnection withAllowlist(List<String> allowlist) {
        return new MewsConnection(UUID.randomUUID(), "https://api.mews-demo.com", "v1:ct", "v1:at",
                "ent", "Demo", "GBP", null, null, null, null, null, null, "Europe/Budapest",
                null, null, null, null, null, allowlist, null);
    }

    @Test
    void noAllowlistLinksEveryGuest() {
        MewsConnection real = withAllowlist(null);
        assertThat(real.hasGuestAllowlist()).isFalse();
        assertThat(real.allowsGuest("anyone@hotel.example")).isTrue();
        assertThat(real.allowsGuest(null)).isTrue();
    }

    @Test
    void anAllowlistMatchesExactEmailsAndPlusTagsIgnoringCase() {
        MewsConnection demo = withAllowlist(List.of("bliss.pms.demo@example.com", "+bliss-e2e"));
        assertThat(demo.allowsGuest("Bliss.PMS.Demo@Example.com")).isTrue();
        assertThat(demo.allowsGuest("brad+bliss-e2e@example.com")).isTrue();
        assertThat(demo.allowsGuest("brad+BLISS-E2E-2@example.com")).isTrue();
        // Near misses do not match.
        assertThat(demo.allowsGuest("bliss.pms.demo@example.org")).isFalse();
        assertThat(demo.allowsGuest("someone@bliss-e2e.example.com")).isFalse();
        assertThat(demo.allowsGuest("voxgate.demo@example.com")).isFalse();
        assertThat(demo.allowsGuest(null)).isFalse();
        assertThat(demo.allowsGuest(" ")).isFalse();
    }

    @Test
    void anEmptyAllowlistLinksNobody() {
        assertThat(withAllowlist(List.of()).allowsGuest("bliss.pms.demo@example.com")).isFalse();
    }
}
