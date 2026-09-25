package com.bliss.b2b.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.bliss.b2b.security.TokenCipher.Field;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class TokenCipherTest {

    private static final UUID MERCHANT = UUID.randomUUID();
    private static final UUID OTHER_MERCHANT = UUID.randomUUID();

    private final TokenCipher cipher = TokenCipher.fromBase64Key(randomKey());

    @Test
    void roundTrips() {
        String sealed = cipher.encrypt(Field.MEWS_ACCESS_TOKEN, MERCHANT, "secret-token");
        assertThat(sealed).startsWith(TokenCipher.PREFIX).doesNotContain("secret-token");
        assertThat(cipher.decrypt(Field.MEWS_ACCESS_TOKEN, MERCHANT, sealed)).isEqualTo("secret-token");
    }

    @Test
    void sameInputSealsDifferentlyEachTime() {
        assertThat(cipher.encrypt(Field.MEWS_ACCESS_TOKEN, MERCHANT, "t"))
                .isNotEqualTo(cipher.encrypt(Field.MEWS_ACCESS_TOKEN, MERCHANT, "t"));
    }

    @Test
    void aValueMovedToAnotherMerchantDoesNotOpen() {
        String sealed = cipher.encrypt(Field.MEWS_ACCESS_TOKEN, MERCHANT, "t");
        assertThatThrownBy(() -> cipher.decrypt(Field.MEWS_ACCESS_TOKEN, OTHER_MERCHANT, sealed))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    void aValueMovedToAnotherColumnDoesNotOpen() {
        String sealed = cipher.encrypt(Field.CLOUDBEDS_ACCESS_TOKEN, MERCHANT, "t");
        assertThatThrownBy(() -> cipher.decrypt(Field.CLOUDBEDS_REFRESH_TOKEN, MERCHANT, sealed))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    void tamperingIsDetected() {
        String sealed = cipher.encrypt(Field.MEWS_CLIENT_TOKEN, MERCHANT, "t");
        byte[] raw = Base64.getDecoder().decode(sealed.substring(TokenCipher.PREFIX.length()));
        raw[raw.length - 1] ^= 1;
        String tampered = TokenCipher.PREFIX + Base64.getEncoder().encodeToString(raw);
        assertThatThrownBy(() -> cipher.decrypt(Field.MEWS_CLIENT_TOKEN, MERCHANT, tampered))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    void aDifferentKeyCannotOpen() {
        String sealed = cipher.encrypt(Field.MEWS_CLIENT_TOKEN, MERCHANT, "t");
        TokenCipher other = TokenCipher.fromBase64Key(randomKey());
        assertThatThrownBy(() -> other.decrypt(Field.MEWS_CLIENT_TOKEN, MERCHANT, sealed))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    void plaintextIsRefusedAndNeverEchoed() {
        assertThatThrownBy(() -> cipher.decrypt(Field.MEWS_CLIENT_TOKEN, MERCHANT, "plain-secret"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageNotContaining("plain-secret");
    }

    @Test
    void productionRefusesABlankKey() {
        assertThatThrownBy(() -> TokenCipher.fromConfig("", true))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("BLISS_TOKEN_ENCRYPTION_KEY");
    }

    @Test
    void developmentFallsBackToTheFixedKey() {
        String sealed = TokenCipher.fromConfig("", false).encrypt(Field.MEWS_CLIENT_TOKEN, MERCHANT, "t");
        assertThat(TokenCipher.development().decrypt(Field.MEWS_CLIENT_TOKEN, MERCHANT, sealed)).isEqualTo("t");
    }

    @Test
    void wrongLengthKeyIsRejected() {
        assertThatThrownBy(() -> TokenCipher.fromBase64Key(Base64.getEncoder().encodeToString(new byte[16])))
                .isInstanceOf(IllegalArgumentException.class);
    }

    private static String randomKey() {
        byte[] key = new byte[32];
        new SecureRandom().nextBytes(key);
        return Base64.getEncoder().encodeToString(key);
    }
}
