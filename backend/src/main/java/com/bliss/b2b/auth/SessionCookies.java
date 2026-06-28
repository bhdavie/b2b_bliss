package com.bliss.b2b.auth;

public final class SessionCookies {

    public static final String COOKIE_NAME = "bliss_session";

    private SessionCookies() {}

    public static String buildSetCookie(String token, int maxAgeSeconds, boolean secure) {
        return buildSetCookie(COOKIE_NAME, token, maxAgeSeconds, secure);
    }

    public static String buildSetCookie(String name, String token, int maxAgeSeconds, boolean secure) {
        StringBuilder sb = new StringBuilder()
                .append(name).append('=').append(token)
                .append("; Path=/")
                .append("; HttpOnly")
                .append("; SameSite=Lax")
                .append("; Max-Age=").append(maxAgeSeconds);
        if (secure) sb.append("; Secure");
        return sb.toString();
    }

    public static String buildClearCookie(boolean secure) {
        return buildClearCookie(COOKIE_NAME, secure);
    }

    public static String buildClearCookie(String name, boolean secure) {
        StringBuilder sb = new StringBuilder()
                .append(name).append('=')
                .append("; Path=/")
                .append("; HttpOnly")
                .append("; SameSite=Lax")
                .append("; Max-Age=0");
        if (secure) sb.append("; Secure");
        return sb.toString();
    }
}
