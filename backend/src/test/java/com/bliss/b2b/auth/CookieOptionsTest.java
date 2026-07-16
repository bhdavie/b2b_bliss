package com.bliss.b2b.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

/**
 * Covers the cookie scope rules and how they render on the wire. Set and clear
 * are asserted in pairs throughout: a browser only overwrites a cookie when the
 * name, Domain and Path all match, so a clear that drifts from its set is a
 * silent logout failure rather than a visible error.
 */
class CookieOptionsTest {

    private static final int MAX_AGE = 3600;
    private static final String TOKEN = "jwt-token-value";

    // -- Defaults: the local-dev shape (same-origin, no TLS) --

    @Test
    void devDefaults_areLaxAndHostOnly() {
        CookieOptions options = CookieOptions.devDefaults();

        assertThat(options.secure()).isFalse();
        assertThat(options.sameSite()).isEqualTo("Lax");
        assertThat(options.domain()).isNull();
    }

    @Test
    void defaults_renderLaxHostOnlyCookie() {
        String cookie = SessionCookies.buildSetCookie(TOKEN, MAX_AGE, CookieOptions.devDefaults());

        assertThat(cookie).isEqualTo(
                "bliss_session=jwt-token-value; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600");
        assertThat(cookie).doesNotContain("Domain=");
        assertThat(cookie).doesNotContain("Secure");
    }

    @Test
    void blankSameSite_fallsBackToLax() {
        assertThat(new CookieOptions(false, "", null).sameSite()).isEqualTo("Lax");
        assertThat(new CookieOptions(false, null, null).sameSite()).isEqualTo("Lax");
    }

    @Test
    void sameSite_isCaseInsensitiveAndNormalized() {
        assertThat(new CookieOptions(false, "lax", null).sameSite()).isEqualTo("Lax");
        assertThat(new CookieOptions(false, "STRICT", null).sameSite()).isEqualTo("Strict");
        assertThat(new CookieOptions(true, "none", null).sameSite()).isEqualTo("None");
    }

    // -- SameSite=None: the cross-site production shape --

    @Test
    void sameSiteNone_withSecure_isAccepted() {
        CookieOptions options = new CookieOptions(true, "None", ".bliss-payments.com");

        assertThat(options.secure()).isTrue();
        assertThat(options.sameSite()).isEqualTo("None");
        assertThat(options.domain()).isEqualTo(".bliss-payments.com");
    }

    @Test
    void sameSiteNone_withoutSecure_isRejected() {
        // Browsers drop a None cookie that is not Secure, so every session would
        // vanish with no error. Fail at construction instead.
        assertThatThrownBy(() -> new CookieOptions(false, "None", ".bliss-payments.com"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("SameSite=None requires Secure")
                .hasMessageContaining("BLISS_COOKIE_SAMESITE");
    }

    @Test
    void invalidSameSite_isRejected() {
        assertThatThrownBy(() -> new CookieOptions(false, "Bogus", null))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("Invalid cookie SameSite value: 'Bogus'");
    }

    // -- Domain rendering, set and clear --

    @Test
    void domain_absent_isOmittedFromBothSetAndClear() {
        CookieOptions hostOnly = new CookieOptions(false, "Lax", null);

        assertThat(SessionCookies.buildSetCookie(TOKEN, MAX_AGE, hostOnly)).doesNotContain("Domain=");
        assertThat(SessionCookies.buildClearCookie(hostOnly)).doesNotContain("Domain=");
    }

    @Test
    void domain_blank_isTreatedAsHostOnly() {
        // config.yml supplies "" when BLISS_COOKIE_DOMAIN is unset, which must
        // mean host-only rather than a literal empty Domain attribute.
        assertThat(new CookieOptions(false, "Lax", "").domain()).isNull();
        assertThat(new CookieOptions(false, "Lax", "   ").domain()).isNull();
    }

    @Test
    void domain_present_appearsInBothSetAndClear() {
        CookieOptions options = new CookieOptions(true, "None", ".bliss-payments.com");

        assertThat(SessionCookies.buildSetCookie(TOKEN, MAX_AGE, options)).isEqualTo(
                "bliss_session=jwt-token-value; Path=/; Domain=.bliss-payments.com; HttpOnly; "
                        + "SameSite=None; Max-Age=3600; Secure");
        assertThat(SessionCookies.buildClearCookie(options)).isEqualTo(
                "bliss_session=; Path=/; Domain=.bliss-payments.com; HttpOnly; "
                        + "SameSite=None; Max-Age=0; Secure");
    }

    @Test
    void clearCookie_hasEmptyValueAndZeroMaxAge() {
        String cookie = SessionCookies.buildClearCookie(CookieOptions.devDefaults());

        assertThat(cookie).startsWith("bliss_session=;");
        assertThat(cookie).contains("Max-Age=0");
    }

    @Test
    void setAndClear_shareScopeAttributes() {
        // The pairing that matters: whatever scope a set uses, the clear must
        // repeat it verbatim or the browser keeps the session cookie.
        CookieOptions options = new CookieOptions(true, "None", ".bliss-payments.com");

        String set = SessionCookies.buildSetCookie(TOKEN, MAX_AGE, options);
        String clear = SessionCookies.buildClearCookie(options);

        for (String scopeAttribute : new String[] {
                "Path=/", "Domain=.bliss-payments.com", "SameSite=None", "HttpOnly", "Secure"}) {
            assertThat(set).contains(scopeAttribute);
            assertThat(clear).contains(scopeAttribute);
        }
    }

    // -- Named cookies: the customer session uses the same options --

    @Test
    void namedCookie_appliesSameScope() {
        CookieOptions options = new CookieOptions(true, "None", ".bliss-payments.com");

        assertThat(SessionCookies.buildSetCookie("bliss_customer_session", TOKEN, MAX_AGE, options))
                .isEqualTo("bliss_customer_session=jwt-token-value; Path=/; "
                        + "Domain=.bliss-payments.com; HttpOnly; SameSite=None; Max-Age=3600; Secure");
        assertThat(SessionCookies.buildClearCookie("bliss_customer_session", options))
                .isEqualTo("bliss_customer_session=; Path=/; Domain=.bliss-payments.com; "
                        + "HttpOnly; SameSite=None; Max-Age=0; Secure");
    }

    @Test
    void secureFlag_appendedOnlyWhenSecure() {
        assertThat(SessionCookies.buildSetCookie(TOKEN, MAX_AGE, new CookieOptions(true, "Lax", null)))
                .endsWith("; Secure");
        assertThat(SessionCookies.buildSetCookie(TOKEN, MAX_AGE, new CookieOptions(false, "Lax", null)))
                .doesNotContain("Secure");
    }
}
