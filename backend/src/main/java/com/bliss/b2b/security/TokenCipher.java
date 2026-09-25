package com.bliss.b2b.security;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.UUID;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Encrypts PMS credentials at rest: the Mews Connector tokens and the Cloudbeds
 * OAuth tokens. AES-256-GCM from the JDK, so no dependency.
 *
 * <p>Stored form is {@code v1:<base64(iv || ciphertext || tag)>}. The prefix is
 * what the V30 CHECK constraints test for, so a plaintext write fails at the
 * database, and it leaves room for a {@code v2} if the key is ever rotated.
 *
 * <p>Every value is bound to its {@link Field} and merchant as GCM associated
 * data. A ciphertext copied into another merchant's row, or from the access
 * token column into the refresh token column, fails to decrypt instead of
 * quietly handing one property another's credentials.
 *
 * <p>The key is {@code BLISS_TOKEN_ENCRYPTION_KEY}: 32 random bytes, base64.
 * Lose it and every stored connection is unreadable; each property then has to
 * reconnect. Development falls back to a fixed key so a fresh checkout boots;
 * production refuses to start without a real one (see {@link #fromConfig}).
 */
public final class TokenCipher {

    private static final Logger log = LoggerFactory.getLogger(TokenCipher.class);

    public static final String PREFIX = "v1:";

    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    private static final int KEY_BYTES = 32;
    private static final int IV_BYTES = 12;
    private static final int TAG_BITS = 128;

    /**
     * Development-only key material. Public on purpose: anything it encrypts is
     * readable by anyone with the repo, which is why production refuses it.
     */
    private static final String DEV_KEY_SEED = "bliss-dev-token-encryption-key-not-for-production";

    /** Each encrypted column. The label is bound into the ciphertext, so never rename one. */
    public enum Field {
        MEWS_CLIENT_TOKEN("merchant_mews_connections.client_token"),
        MEWS_ACCESS_TOKEN("merchant_mews_connections.access_token"),
        CLOUDBEDS_ACCESS_TOKEN("merchant_cloudbeds_connections.access_token"),
        CLOUDBEDS_REFRESH_TOKEN("merchant_cloudbeds_connections.refresh_token");

        private final String label;

        Field(String label) {
            this.label = label;
        }
    }

    private final SecretKeySpec key;
    private final SecureRandom random = new SecureRandom();

    private TokenCipher(byte[] keyBytes) {
        if (keyBytes.length != KEY_BYTES) {
            throw new IllegalArgumentException(
                    "Token encryption key must be " + KEY_BYTES + " bytes, got " + keyBytes.length);
        }
        this.key = new SecretKeySpec(keyBytes, "AES");
    }

    /** A cipher over a base64-encoded 32-byte key. */
    public static TokenCipher fromBase64Key(String base64Key) {
        byte[] bytes;
        try {
            bytes = Base64.getDecoder().decode(base64Key.trim());
        } catch (IllegalArgumentException e) {
            throw new IllegalArgumentException("Token encryption key is not valid base64", e);
        }
        return new TokenCipher(bytes);
    }

    /** The fixed development key. Never valid in production. */
    public static TokenCipher development() {
        try {
            byte[] bytes = MessageDigest.getInstance("SHA-256")
                    .digest(DEV_KEY_SEED.getBytes(StandardCharsets.UTF_8));
            return new TokenCipher(bytes);
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }

    /**
     * The cipher for a configured key. A blank key is an error in production
     * and falls back to {@link #development()} everywhere else.
     */
    public static TokenCipher fromConfig(String base64Key, boolean production) {
        if (base64Key != null && !base64Key.isBlank()) {
            return fromBase64Key(base64Key);
        }
        if (production) {
            throw new IllegalStateException(
                    "BLISS_ENV=production but BLISS_TOKEN_ENCRYPTION_KEY is not set, so stored PMS "
                            + "credentials cannot be encrypted or read. Set it to 32 random bytes, "
                            + "base64 (e.g. `openssl rand -base64 32`), keep a copy somewhere safe, "
                            + "and redeploy. Losing it means every property reconnects.");
        }
        log.warn("BLISS_TOKEN_ENCRYPTION_KEY not set; using the development key for PMS credentials");
        return development();
    }

    public boolean isEncrypted(String stored) {
        return stored != null && stored.startsWith(PREFIX);
    }

    public String encrypt(Field field, UUID merchantId, String plaintext) {
        if (plaintext == null) {
            throw new IllegalArgumentException("Cannot encrypt a null " + field.label);
        }
        byte[] iv = new byte[IV_BYTES];
        random.nextBytes(iv);
        try {
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.ENCRYPT_MODE, key, new GCMParameterSpec(TAG_BITS, iv));
            cipher.updateAAD(aad(field, merchantId));
            byte[] sealed = cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));
            byte[] out = ByteBuffer.allocate(iv.length + sealed.length).put(iv).put(sealed).array();
            return PREFIX + Base64.getEncoder().encodeToString(out);
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("Could not encrypt " + field.label, e);
        }
    }

    /**
     * The plaintext of a stored value. Throws if the value is not in the
     * {@code v1:} form, was written for another field or merchant, was
     * tampered with, or was encrypted under a different key. The message never
     * includes the value.
     */
    public String decrypt(Field field, UUID merchantId, String stored) {
        if (!isEncrypted(stored)) {
            throw new IllegalStateException(
                    "Stored " + field.label + " for merchant " + merchantId + " is not encrypted");
        }
        byte[] in;
        try {
            in = Base64.getDecoder().decode(stored.substring(PREFIX.length()));
        } catch (IllegalArgumentException e) {
            throw new IllegalStateException(
                    "Stored " + field.label + " for merchant " + merchantId + " is malformed", e);
        }
        if (in.length <= IV_BYTES) {
            throw new IllegalStateException(
                    "Stored " + field.label + " for merchant " + merchantId + " is malformed");
        }
        try {
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(TAG_BITS, in, 0, IV_BYTES));
            cipher.updateAAD(aad(field, merchantId));
            byte[] plain = cipher.doFinal(in, IV_BYTES, in.length - IV_BYTES);
            return new String(plain, StandardCharsets.UTF_8);
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException(
                    "Could not decrypt " + field.label + " for merchant " + merchantId
                            + " (wrong key, wrong row, or tampered)", e);
        }
    }

    private static byte[] aad(Field field, UUID merchantId) {
        return (field.label + ":" + merchantId).getBytes(StandardCharsets.UTF_8);
    }
}
