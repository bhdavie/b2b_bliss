package com.bliss.b2b.integration.pms;

import static org.assertj.core.api.Assertions.assertThat;

import com.bliss.b2b.domain.MewsConnection;
import com.bliss.b2b.persistence.MerchantMewsConnectionDao;
import com.bliss.b2b.security.TokenCipher;
import com.bliss.b2b.security.TokenCipher.Field;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class MewsAdapterFactoryTest {

    private static final UUID MERCHANT = UUID.randomUUID();
    private static final TokenCipher CIPHER = TokenCipher.development();

    @Test
    void resolvesWithTheStoredCurrency() {
        MewsAdapterFactory factory = new MewsAdapterFactory(daoReturning(connection("USD")), CIPHER, 0);
        assertThat(factory.resolve(MERCHANT)).hasValueSatisfying(ctx ->
                assertThat(ctx.currency()).isEqualTo("USD"));
    }

    @Test
    void noCurrencyMeansNoChargeContextRatherThanAGuess() {
        assertThat(new MewsAdapterFactory(daoReturning(connection(null)), CIPHER, 0).resolve(MERCHANT)).isEmpty();
        assertThat(new MewsAdapterFactory(daoReturning(connection(" ")), CIPHER, 0).resolve(MERCHANT)).isEmpty();
    }

    @Test
    void savesOnlySealedTokensAndReadsThemBack() {
        String[] stored = new String[2];
        MerchantMewsConnectionDao capturing = new MerchantMewsConnectionDao() {
            @Override
            public Optional<MewsConnection> findByMerchant(UUID merchantId) {
                return Optional.empty();
            }

            @Override
            public void upsertValidated(UUID merchantId, String platformUrl, String encryptedClientToken,
                    String encryptedAccessToken, String enterpriseId, String enterpriseName,
                    String currency, Instant validatedAt) {
                stored[0] = encryptedClientToken;
                stored[1] = encryptedAccessToken;
            }

            @Override
            public int updateBookingSetup(UUID merchantId, String serviceId, String blissRateId,
                    String adultAgeCategoryId, String timeZone) {
                return 0;
            }

            @Override
            public int deleteByMerchant(UUID merchantId) {
                return 0;
            }
        };
        new MewsAdapterFactory(capturing, CIPHER, 0).saveValidatedConnection(
                MERCHANT, "https://api.mews.com", "client-plain", "access-plain",
                new PmsPropertyConfiguration("ent", "Cranberry", "USD", "US", "Gross", "America/New_York"),
                Instant.now());

        assertThat(stored[0]).startsWith("v1:").doesNotContain("client-plain");
        assertThat(stored[1]).startsWith("v1:").doesNotContain("access-plain");
        assertThat(CIPHER.decrypt(Field.MEWS_CLIENT_TOKEN, MERCHANT, stored[0])).isEqualTo("client-plain");
        assertThat(CIPHER.decrypt(Field.MEWS_ACCESS_TOKEN, MERCHANT, stored[1])).isEqualTo("access-plain");
    }

    private static MewsConnection connection(String currency) {
        Instant now = Instant.now();
        return new MewsConnection(MERCHANT, "https://api.mews.com",
                CIPHER.encrypt(Field.MEWS_CLIENT_TOKEN, MERCHANT, "ct"),
                CIPHER.encrypt(Field.MEWS_ACCESS_TOKEN, MERCHANT, "at"),
                "ent", "Cranberry", currency, now, now, now, null, null, null, null);
    }

    private static MerchantMewsConnectionDao daoReturning(MewsConnection conn) {
        return new MerchantMewsConnectionDao() {
            @Override
            public Optional<MewsConnection> findByMerchant(UUID merchantId) {
                return Optional.of(conn);
            }

            @Override
            public void upsertValidated(UUID merchantId, String platformUrl, String encryptedClientToken,
                    String encryptedAccessToken, String enterpriseId, String enterpriseName,
                    String currency, Instant validatedAt) {
                throw new UnsupportedOperationException();
            }

            @Override
            public int updateBookingSetup(UUID merchantId, String serviceId, String blissRateId,
                    String adultAgeCategoryId, String timeZone) {
                throw new UnsupportedOperationException();
            }

            @Override
            public int deleteByMerchant(UUID merchantId) {
                throw new UnsupportedOperationException();
            }
        };
    }
}
