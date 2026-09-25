package com.bliss.b2b.service;

import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Clock;
import org.junit.jupiter.api.Test;

/**
 * The platform url rules on connectMews. Both fire before any Mews call or
 * database write, so the service is built with no collaborators.
 */
class PropertyOnboardingMewsUrlTest {

    private final PropertyOnboardingService service =
            new PropertyOnboardingService(null, null, null, null, null, Clock.systemUTC());

    @Test
    void blankPlatformUrlIsRejectedNotDefaultedToDemo() {
        assertThatThrownBy(() -> service.connectMews(null, " ", "ct", "at"))
                .isInstanceOf(PropertyOnboardingException.class)
                .extracting(e -> ((PropertyOnboardingException) e).code())
                .isEqualTo("missing_platform_url");
    }

    @Test
    void unknownPlatformUrlIsRejected() {
        assertThatThrownBy(() -> service.connectMews(null, "https://tokens.example", "ct", "at"))
                .isInstanceOf(PropertyOnboardingException.class)
                .extracting(e -> ((PropertyOnboardingException) e).code())
                .isEqualTo("unsupported_platform_url");
    }
}
