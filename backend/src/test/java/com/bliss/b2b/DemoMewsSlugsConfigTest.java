package com.bliss.b2b;

import static org.assertj.core.api.Assertions.assertThat;

import com.bliss.b2b.BlissConfiguration.AppConfig;
import org.junit.jupiter.api.Test;

/** Which Mews properties may take dashboard bookings on the demo path (BLISS_DEMO_MEWS_SLUGS). */
class DemoMewsSlugsConfigTest {

    @Test
    void unsetListsNoProperty() {
        AppConfig app = new AppConfig();
        app.setDemoMewsSlugs(null);
        assertThat(app.isDemoMewsProperty("j9l29fke")).isFalse();
        assertThat(app.isDemoMewsProperty("")).isFalse();
    }

    @Test
    void listedSlugsMatchExactlyWithSpacesTrimmed() {
        AppConfig app = new AppConfig();
        app.setDemoMewsSlugs(" j9l29fke , abc123 ");
        assertThat(app.isDemoMewsProperty("j9l29fke")).isTrue();
        assertThat(app.isDemoMewsProperty("abc123")).isTrue();
        assertThat(app.isDemoMewsProperty("j9l29")).isFalse();
        assertThat(app.isDemoMewsProperty("cranberry")).isFalse();
        assertThat(app.isDemoMewsProperty(null)).isFalse();
    }
}
