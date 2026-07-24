package com.bliss.b2b.integration.pms;

import com.bliss.b2b.BlissConfiguration.PmsConfig.MewsPmsConfig;
import com.bliss.b2b.domain.MewsConnection;
import com.bliss.b2b.persistence.MerchantMewsConnectionDao;
import com.bliss.b2b.service.InstallmentChargeService.ChargeContext;
import com.bliss.b2b.service.InstallmentChargeService.ChargeContextResolver;
import java.util.Optional;
import java.util.UUID;
import org.jdbi.v3.core.Jdbi;

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
 */
public class MewsAdapterFactory implements ChargeContextResolver {

    /** Fallback currency when a connection has no stored currency yet. */
    private static final String DEFAULT_CURRENCY = "GBP";

    private final MerchantMewsConnectionDao connectionDao;
    /** Demo charge cap in cents, threaded into every adapter this factory builds. */
    private final long chargeCapCents;

    public MewsAdapterFactory(Jdbi jdbi) {
        this(jdbi, 0);
    }

    public MewsAdapterFactory(Jdbi jdbi, long chargeCapCents) {
        this.connectionDao = jdbi.onDemand(MerchantMewsConnectionDao.class);
        this.chargeCapCents = chargeCapCents;
    }

    MewsAdapterFactory(MerchantMewsConnectionDao connectionDao) {
        this.connectionDao = connectionDao;
        this.chargeCapCents = 0;
    }

    /**
     * A Mews adapter over the given raw credentials, not persisted. Used to call
     * {@code configuration/get} during connection validation.
     */
    public MewsAdapter adapterForCredentials(
            String platformUrl, String clientToken, String accessToken) {
        return new MewsAdapter(configOf(platformUrl, clientToken, accessToken), chargeCapCents);
    }

    /** A Mews adapter bound to a stored connection's credentials. */
    public MewsAdapter adapterForConnection(MewsConnection connection) {
        return new MewsAdapter(configOf(
                connection.platformUrl(), connection.clientToken(), connection.accessToken()),
                chargeCapCents);
    }

    @Override
    public Optional<ChargeContext> resolve(UUID merchantId) {
        return connectionDao.findByMerchant(merchantId)
                .filter(MewsConnection::isValidated)
                .map(conn -> new ChargeContext(
                        adapterForConnection(conn),
                        conn.currency() == null || conn.currency().isBlank()
                                ? DEFAULT_CURRENCY : conn.currency()));
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
