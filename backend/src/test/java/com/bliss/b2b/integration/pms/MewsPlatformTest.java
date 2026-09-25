package com.bliss.b2b.integration.pms;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class MewsPlatformTest {

    @Test
    void acceptsBothMewsEnvironments() {
        assertThat(MewsPlatform.normalize("https://api.mews.com")).contains("https://api.mews.com");
        assertThat(MewsPlatform.normalize("https://api.mews-demo.com")).contains("https://api.mews-demo.com");
    }

    @Test
    void toleratesWhitespaceTrailingSlashAndCase() {
        assertThat(MewsPlatform.normalize("  HTTPS://API.MEWS.COM/ ")).contains("https://api.mews.com");
    }

    @Test
    void rejectsEverythingElse() {
        assertThat(MewsPlatform.normalize(null)).isEmpty();
        assertThat(MewsPlatform.normalize("")).isEmpty();
        assertThat(MewsPlatform.normalize("http://api.mews.com")).isEmpty();
        assertThat(MewsPlatform.normalize("https://api.mews.com.evil.example")).isEmpty();
        assertThat(MewsPlatform.normalize("https://api.mews.com/api/connector/v1")).isEmpty();
        assertThat(MewsPlatform.normalize("https://evil.example")).isEmpty();
    }

    @Test
    void mapsEachEnvironmentToItsCheckoutHost() {
        assertThat(MewsPlatform.appBaseUrl("https://api.mews.com")).contains("https://app.mews.com");
        assertThat(MewsPlatform.appBaseUrl("https://api.mews-demo.com")).contains("https://app.mews-demo.com");
        assertThat(MewsPlatform.appBaseUrl("https://api.example.com")).isEmpty();
    }
}
