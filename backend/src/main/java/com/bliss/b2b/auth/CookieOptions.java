package com.bliss.b2b.auth;

import java.util.Set;

/**
 * Scope and security attributes applied to every session cookie Bliss issues.
 *
 * <p>Built once at startup from config so the set and clear paths cannot drift:
 * a cookie is only overwritten by a later Set-Cookie whose name, Domain and
 * Path all match, so a logout that omits the Domain the login set would leave
 * the session cookie in place.
 *
 * <p>Production splits the frontend across property./guest.bliss-payments.com
 * while the API answers on api.bliss-payments.com. Those are cross-site, so the
 * cookie needs {@code SameSite=None} and a {@code Domain} on the shared parent.
 * Local dev is same-site and keeps the {@code Lax} / host-only default.
 *
 * @param secure   append {@code Secure}; driven by whether the env is production
 * @param sameSite {@code Lax}, {@code Strict} or {@code None}
 * @param domain   cookie {@code Domain}, or null for host-only
 */
public record CookieOptions(boolean secure, String sameSite, String domain) {

    private static final Set<String> VALID_SAME_SITE = Set.of("Lax", "Strict", "None");
    private static final String DEFAULT_SAME_SITE = "Lax";

    public CookieOptions {
        sameSite = normalizeSameSite(sameSite);
        domain = (domain == null || domain.isBlank()) ? null : domain.trim();

        // Browsers reject SameSite=None without Secure outright, which would
        // drop every session silently. Fail at boot with a readable message
        // instead of shipping cookies nothing will store.
        if ("None".equals(sameSite) && !secure) {
            throw new IllegalArgumentException(
                    "Cookie SameSite=None requires Secure, but secure cookies are off. "
                            + "Secure is enabled only when BLISS_ENV=production, so either set "
                            + "BLISS_ENV=production or use BLISS_COOKIE_SAMESITE=Lax.");
        }
    }

    /** Host-only, Lax, non-secure. The local-dev shape. */
    public static CookieOptions devDefaults() {
        return new CookieOptions(false, DEFAULT_SAME_SITE, null);
    }

    private static String normalizeSameSite(String value) {
        if (value == null || value.isBlank()) {
            return DEFAULT_SAME_SITE;
        }
        String trimmed = value.trim();
        for (String valid : VALID_SAME_SITE) {
            if (valid.equalsIgnoreCase(trimmed)) {
                return valid;
            }
        }
        throw new IllegalArgumentException(
                "Invalid cookie SameSite value: '" + trimmed + "'. Expected one of " + VALID_SAME_SITE);
    }
}
