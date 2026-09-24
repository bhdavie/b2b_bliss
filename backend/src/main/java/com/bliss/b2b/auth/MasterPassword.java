package com.bliss.b2b.auth;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

/**
 * TEMPORARY DEMO PASSWORD — REMOVE BEFORE REAL MERCHANT OR GUEST ONBOARDING.
 *
 * <p>The shared secret behind the merchant, admin and guest
 * {@code /password-login} routes, which is how the hosted demo accounts sign in
 * with an email and a password. On its own it admits nobody: every route asks
 * {@link DemoPassword}, which also requires the address to be in
 * {@code BLISS_DEMO_LOGIN_EMAILS}. No route ever creates an account.
 *
 * <p>It used to sign in as any existing merchant or admin. That was removed in
 * fe5f691, which also broke the demo accounts; this is the narrowed return.
 *
 * <p>Removal: delete this file and {@link DemoPassword}, the
 * {@code masterPassword} field on {@link com.bliss.b2b.BlissConfiguration}, the
 * {@code masterPassword} line in {@code config.yml}, {@code passwordLogin} on
 * AuthResource, AdminAuthResource and PublicAccountResource, the
 * {@code MASTER_PASSWORD} entry in {@code .env.example}, and the password
 * branches of the three sign-in pages.
 */
public final class MasterPassword {

    private final String secret;

    /** @param secret the configured MASTER_PASSWORD; null or blank disables it. */
    public MasterPassword(String secret) {
        this.secret = secret == null || secret.isBlank() ? null : secret;
    }

    /** True when MASTER_PASSWORD is set. */
    public boolean isEnabled() {
        return secret != null;
    }

    /**
     * Constant-time comparison of a submitted password against the configured
     * secret. False whenever it is disabled or the input is empty, so a missing
     * MASTER_PASSWORD can never be matched by an empty submission.
     */
    public boolean matches(String submitted) {
        if (secret == null || submitted == null || submitted.isEmpty()) return false;
        return MessageDigest.isEqual(
                secret.getBytes(StandardCharsets.UTF_8),
                submitted.getBytes(StandardCharsets.UTF_8));
    }
}
