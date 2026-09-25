package com.bliss.b2b.integration.pms;

import java.util.Locale;
import java.util.Map;
import java.util.Optional;

/**
 * The Mews environments a property may connect to, and the Payments Checkout
 * host that goes with each.
 *
 * <p>An allowlist, not a pattern. A property's Connector tokens are POSTed to
 * whatever platform url its connection stores, so accepting a free-text url
 * would let anyone with a merchant session point our server, carrying real
 * tokens, at a host of their choosing. Production and the public demo
 * environment are the only two Mews runs.
 */
public final class MewsPlatform {

    public static final String PRODUCTION_API = "https://api.mews.com";
    public static final String DEMO_API = "https://api.mews-demo.com";

    /** Connector api host -> the app host that serves the checkout embed. */
    private static final Map<String, String> APP_BASE_URLS = Map.of(
            PRODUCTION_API, "https://app.mews.com",
            DEMO_API, "https://app.mews-demo.com");

    private MewsPlatform() {
    }

    /**
     * The canonical form of {@code url} if it names an allowed Mews
     * environment, else empty. Tolerates surrounding whitespace, a trailing
     * slash and upper case in the scheme or host; nothing else.
     */
    public static Optional<String> normalize(String url) {
        if (url == null) {
            return Optional.empty();
        }
        String trimmed = url.trim();
        while (trimmed.endsWith("/")) {
            trimmed = trimmed.substring(0, trimmed.length() - 1);
        }
        String lower = trimmed.toLowerCase(Locale.ROOT);
        return APP_BASE_URLS.containsKey(lower) ? Optional.of(lower) : Optional.empty();
    }

    /** The checkout embed host for a stored platform url, or empty if it is not an allowed one. */
    public static Optional<String> appBaseUrl(String platformUrl) {
        return normalize(platformUrl).map(APP_BASE_URLS::get);
    }
}
