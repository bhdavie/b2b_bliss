package com.bliss.b2b.auth;

public final class SessionCookies {

    public static final String COOKIE_NAME = "bliss_session";

    private SessionCookies() {}

    public static String buildSetCookie(String token, int maxAgeSeconds, boolean secure) {
        StringBuilder sb = new StringBuilder()
                .append(COOKIE_NAME).append('=').append(token)
                .append("; Path=/")
                .append("; HttpOnly")
                .append("; SameSite=Lax")
                .append("; Max-Age=").append(maxAgeSeconds);
        if (secure) sb.append("; Secure");
        return sb.toString();
    }

    public static String buildClearCookie(boolean secure) {
        StringBuilder sb = new StringBuilder()
                .append(COOKIE_NAME).append('=')
                .append("; Path=/")
                .append("; HttpOnly")
                .append("; SameSite=Lax")
                .append("; Max-Age=0");
        if (secure) sb.append("; Secure");
        return sb.toString();
    }
}
