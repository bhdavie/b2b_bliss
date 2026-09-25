package com.bliss.b2b.integration.pms;

import com.bliss.b2b.BlissConfiguration.PmsConfig.MewsPmsConfig;
import com.bliss.b2b.domain.MewsConnection;
import com.bliss.b2b.persistence.MerchantMewsConnectionDao;
import com.bliss.b2b.security.TokenCipher;
import com.bliss.b2b.security.TokenCipher.Field;
import com.bliss.b2b.service.InstallmentChargeService.ChargeContext;
import com.bliss.b2b.service.InstallmentChargeService.ChargeContextResolver;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.jdbi.v3.core.Jdbi;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Builds {@link MewsAdapter}s bound to a specific property's Connector
 * credentials. Two uses:
 *
 * <ul>
 *   <li>{@link #adapterForCredentials} — a throwaway adapter over tokens a
 *       property just entered, used to validate the connection before storing.
 *   <li>{@link #resolve} — the charge pass's {@link ChargeContextResolver}:
 *       given a merchant, load its stored, validated Mews connection and return
 *       an adapter plus the currency to charge in. Empty when the property has
 *       no validated connection, so the pass never charges one property on
 *       another's credentials.
 * </ul>
 *
 * <p>The global demo {@link MewsPmsConfig} is no longer used for charging; each
 * property brings its own tokens.
 *
 * <p>This is the one place a stored Mews token is sealed or opened
 * ({@link #saveValidatedConnection} and {@link #adapterForConnection}), so
 * plaintext tokens exist only inside an adapter that is about to call Mews.
 */
public class MewsAdapterFactory implements ChargeContextResolver {

    private static final Logger log = LoggerFactory.getLogger(MewsAdapterFactory.class);

    private final MerchantMewsConnectionDao connectionDao;
    private final TokenCipher cipher;
    /** Demo charge cap in cents, threaded into every adapter this factory builds. */
    private final long chargeCapCents;

    public MewsAdapterFactory(Jdbi jdbi, TokenCipher cipher, long chargeCapCents) {
        this(jdbi.onDemand(MerchantMewsConnectionDao.class), cipher, chargeCapCents);
    }

    MewsAdapterFactory(MerchantMewsConnectionDao connectionDao, TokenCipher cipher, long chargeCapCents) {
        this.connectionDao = connectionDao;
        this.cipher = cipher;
        this.chargeCapCents = chargeCapCents;
    }

    /**
     * Seals the tokens and stores a property's validated connection. Callers
     * pass plaintext; only ciphertext reaches the database.
     */
    public void saveValidatedConnection(
            UUID merchantId, String platformUrl, String clientToken, String accessToken,
            PmsPropertyConfiguration enterprise, Instant validatedAt) {
        connectionDao.upsertValidated(
                merchantId, platformUrl,
                cipher.encrypt(Field.MEWS_CLIENT_TOKEN, merchantId, clientToken),
                cipher.encrypt(Field.MEWS_ACCESS_TOKEN, merchantId, accessToken),
                enterprise.enterpriseId(), enterprise.name(), enterprise.defaultCurrency(),
                validatedAt);
    }

    /**
     * A Mews adapter over the given raw credentials, not persisted. Used to call
     * {@code configuration/get} during connection validation.
     */
    public MewsAdapter adapterForCredentials(
            String platformUrl, String clientToken, String accessToken) {
        return new MewsAdapter(configOf(platformUrl, clientToken, accessToken), chargeCapCents);
    }

    /** A Mews adapter bound to a stored connection's credentials, opened here. */
    public MewsAdapter adapterForConnection(MewsConnection connection) {
        UUID merchantId = connection.merchantId();
        return new MewsAdapter(configOf(
                connection.platformUrl(),
                cipher.decrypt(Field.MEWS_CLIENT_TOKEN, merchantId, connection.encryptedClientToken()),
                cipher.decrypt(Field.MEWS_ACCESS_TOKEN, merchantId, connection.encryptedAccessToken())),
                chargeCapCents);
    }

    /**
     * Empty when the property has no validated connection, or when that
     * connection has no currency. There is deliberately no fallback currency:
     * chargeStoredCard sends Currency and GrossValue as independent fields, so
     * a guessed currency would label a real charge wrongly rather than fail.
     * The charge pass leaves the installment scheduled, so it charges on the
     * first pass after the currency is set.
     */
    @Override
    public Optional<ChargeContext> resolve(UUID merchantId) {
        return connectionDao.findByMerchant(merchantId)
                .filter(MewsConnection::isValidated)
                .filter(conn -> {
                    boolean hasCurrency = conn.currency() != null && !conn.currency().isBlank();
                    if (!hasCurrency) {
                        log.warn("Mews connection for merchant {} has no currency; not charging", merchantId);
                    }
                    return hasCurrency;
                })
                .map(conn -> new ChargeContext(adapterForConnection(conn), conn.currency()));
    }

    /**
     * Resolves a property's own {@link MewsAdapter} for the reconciliation pass.
     * Same per-property credential lookup as {@link #resolve}, but hands back the
     * concrete adapter (which exposes {@code payments/getAll} via
     * {@link MewsAdapter#getPayments}) rather than a {@link ChargeContext}. Empty
     * when the property has no validated connection, so the pass never queries
     * one property against another's credentials.
     */
    public Optional<MewsAdapter> resolveMewsAdapter(UUID merchantId) {
        return connectionDao.findByMerchant(merchantId)
                .filter(MewsConnection::isValidated)
                .map(this::adapterForConnection);
    }

    private static MewsPmsConfig configOf(String platformUrl, String clientToken, String accessToken) {
        MewsPmsConfig config = new MewsPmsConfig();
        if (platformUrl != null && !platformUrl.isBlank()) {
            config.setPlatformUrl(platformUrl);
        }
        config.setClientToken(clientToken);
        config.setAccessToken(accessToken);
        return config;
    }
}
