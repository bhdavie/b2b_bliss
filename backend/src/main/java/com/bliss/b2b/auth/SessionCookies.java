package com.bliss.b2b.auth;

public final class SessionCookies {

    public static final String COOKIE_NAME = "bliss_session";

    /**
     * Bliss internal admin session. A separate cookie rather than a claim on the
     * merchant one so signing out of the property dashboard cannot leave an
     * admin session alive, or the reverse. Built through the same builder below,
     * so its Domain, Path and SameSite match and a clear always undoes a set.
     */
    public static final String ADMIN_COOKIE_NAME = "bliss_admin_session";

    private SessionCookies() {}

    public static String buildSetCookie(String token, int maxAgeSeconds, CookieOptions options) {
        return buildSetCookie(COOKIE_NAME, token, maxAgeSeconds, options);
    }

    public static String buildSetCookie(String name, String token, int maxAgeSeconds, CookieOptions options) {
        return build(name, token, maxAgeSeconds, options);
    }

    public static String buildClearCookie(CookieOptions options) {
        return buildClearCookie(COOKIE_NAME, options);
    }

    public static String buildClearCookie(String name, CookieOptions options) {
        return build(name, "", 0, options);
    }

    /**
     * Set and clear share this builder so the two always emit the same Domain,
     * Path and SameSite. A clear whose scope differs from the set is a no-op in
     * the browser and the session survives logout.
     */
    private static String build(String name, String token, int maxAgeSeconds, CookieOptions options) {
        StringBuilder sb = new StringBuilder()
                .append(name).append('=').append(token)
                .append("; Path=/");
        if (options.domain() != null) {
            sb.append("; Domain=").append(options.domain());
        }
        sb.append("; HttpOnly")
                .append("; SameSite=").append(options.sameSite())
                .append("; Max-Age=").append(maxAgeSeconds);
        if (options.secure()) {
            sb.append("; Secure");
        }
        return sb.toString();
    }
}
