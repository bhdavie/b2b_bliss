package com.bliss.b2b.auth;

import java.util.Set;

/**
 * TEMPORARY DEMO PASSWORD — REMOVE BEFORE REAL MERCHANT OR GUEST ONBOARDING.
 *
 * <p>The one rule behind all three {@code /password-login} routes (merchant,
 * admin and guest): the email is in {@code BLISS_DEMO_LOGIN_EMAILS} AND the
 * password is {@code MASTER_PASSWORD}. Each route then adds its own last check,
 * that an account of its kind already exists, and none of them ever creates one.
 * Kept in one object so the three surfaces cannot drift onto different rules.
 *
 * <p>Off unless both are set: with no allowlist there is nobody it may admit, so
 * the routes 404 and the sign-in pages hide the password field.
 */
public final class DemoPassword {

    private final MasterPassword masterPassword;
    /** Lowercased and trimmed, as BlissApplication builds it. */
    private final Set<String> allowlist;

    public DemoPassword(MasterPassword masterPassword, Set<String> allowlist) {
        this.masterPassword = masterPassword;
        this.allowlist = allowlist;
    }

    /** MASTER_PASSWORD is set and there is at least one address it can reach. */
    public boolean isEnabled() {
        return masterPassword.isEnabled() && !allowlist.isEmpty();
    }

    /**
     * True only when enabled, the address is allowlisted and the password
     * matches. The password is compared whatever the address, so an address
     * that is not allowlisted does not answer measurably faster than a wrong
     * password.
     *
     * @param normalizedEmail already trimmed and lowercased
     */
    public boolean admits(String normalizedEmail, String password) {
        boolean passwordMatches = masterPassword.matches(password);
        return isEnabled() && passwordMatches && allowlist.contains(normalizedEmail);
    }
}
