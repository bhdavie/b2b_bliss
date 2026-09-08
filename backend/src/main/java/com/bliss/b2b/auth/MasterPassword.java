package com.bliss.b2b.auth;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

/**
 * TEMPORARY MASTER PASSWORD BYPASS — REMOVE BEFORE REAL MERCHANT OR GUEST
 * ONBOARDING.
 *
 * <p>When {@code MASTER_PASSWORD} is set, a single shared secret signs in as
 * any EXISTING merchant or admin, bypassing the magic-link round trip. It is a
 * development and demo convenience only: one leaked string is every internal
 * account, there is no per-user attribution, no rotation and no revocation.
 *
 * <p>Removal is deliberately small: delete this file, the {@code masterPassword}
 * field on {@link com.bliss.b2b.BlissConfiguration}, the {@code masterPassword}
 * line in {@code config.yml}, the two {@code /password-login} endpoints on
 * {@link com.bliss.b2b.api.AuthResource} and
 * {@link com.bliss.b2b.api.AdminAuthResource}, and the {@code MASTER_PASSWORD}
 * entries in {@code backend/.env} and {@code .env.example}.
 *
 * <p>This bypass ADDS a way in; it takes none away. Magic link, the demo
 * dev-login gate and the guest flow all behave exactly as before, and nothing
 * here reads or writes a stored credential.
 */
public final class MasterPassword {

    private final String secret;

    /** @param secret the configured MASTER_PASSWORD; null or blank disables the bypass. */
    public MasterPassword(String secret) {
        this.secret = secret == null || secret.isBlank() ? null : secret;
    }

    /** True when MASTER_PASSWORD is set, so the bypass routes should answer at all. */
    public boolean isEnabled() {
        return secret != null;
    }

    /**
     * Constant-time comparison of a submitted password against the configured
     * secret. False whenever the bypass is disabled or the input is empty, so a
     * missing MASTER_PASSWORD can never be matched by an empty submission.
     */
    public boolean matches(String submitted) {
        if (secret == null || submitted == null || submitted.isEmpty()) return false;
        return MessageDigest.isEqual(
                secret.getBytes(StandardCharsets.UTF_8),
                submitted.getBytes(StandardCharsets.UTF_8));
    }
}
