package com.bliss.b2b.integration.pms;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/**
 * Mews certification reviews demo traffic by the Client string, in the
 * "Name Version" form its docs ask for. Guard the shape so a refactor cannot
 * quietly send a bare name or a second, different identity.
 */
class MewsAdapterClientTest {

    @Test
    void clientIsBlissPaymentsWithASemanticVersion() {
        assertThat(MewsAdapter.CLIENT).matches("Bliss Payments \\d+\\.\\d+\\.\\d+");
    }
}
