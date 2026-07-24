package com.bliss.b2b.integration.pms;

import com.bliss.b2b.BlissConfiguration.PmsConfig.CloudbedsPmsConfig;
import com.bliss.b2b.domain.CloudbedsConnection;
import com.bliss.b2b.integration.cloudbeds.CloudbedsOAuthClient;
import com.bliss.b2b.integration.cloudbeds.CloudbedsOAuthClient.CloudbedsOAuthException;
import com.bliss.b2b.integration.cloudbeds.CloudbedsTokens;
import com.bliss.b2b.persistence.MerchantCloudbedsConnectionDao;
import com.bliss.b2b.service.InstallmentChargeService.ChargeContext;
import com.bliss.b2b.service.InstallmentChargeService.ChargeContextResolver;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.jdbi.v3.core.Jdbi;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Builds {@link CloudbedsAdapter}s bound to a specific property's OAuth tokens,
 * refreshing the access token transparently when it is near expiry. Mirrors
 * {@link MewsAdapterFactory}: it is the charge pass's
 * {@link ChargeContextResolver} for the Cloudbeds rail.
 *
 * <p>Refresh is <b>single-flight per merchant</b>: concurrent resolves for the
 * same property serialize on a per-merchant lock and re-check expiry inside it,
 * so only the first caller performs the network refresh and rewrites the tokens;
 * the rest reuse the freshly-stored access token.
 */
public class CloudbedsAdapterFactory implements ChargeContextResolver {

    private static final Logger log = LoggerFactory.getLogger(CloudbedsAdapterFactory.class);

    private static final String DEFAULT_CURRENCY = "USD";
    /** Refresh when the access token is within this window of expiry. */
    private static final Duration REFRESH_SKEW = Duration.ofMinutes(5);

    private final MerchantCloudbedsConnectionDao connectionDao;
    private final CloudbedsOAuthClient oauthClient;
    private final CloudbedsPmsConfig config;
    private final long chargeCapCents;
    private final Clock clock;

    /** Per-merchant refresh locks so concurrent resolves don't double-refresh. */
    private final ConcurrentHashMap<UUID, Object> refreshLocks = new ConcurrentHashMap<>();

    public CloudbedsAdapterFactory(
            Jdbi jdbi, CloudbedsOAuthClient oauthClient, CloudbedsPmsConfig config,
            long chargeCapCents, Clock clock) {
        this.connectionDao = jdbi.onDemand(MerchantCloudbedsConnectionDao.class);
        this.oauthClient = oauthClient;
        this.config = config;
        this.chargeCapCents = chargeCapCents;
        this.clock = clock;
    }

    CloudbedsAdapterFactory(
            MerchantCloudbedsConnectionDao connectionDao, CloudbedsOAuthClient oauthClient,
            CloudbedsPmsConfig config, long chargeCapCents, Clock clock) {
        this.connectionDao = connectionDao;
        this.oauthClient = oauthClient;
        this.config = config;
        this.chargeCapCents = chargeCapCents;
        this.clock = clock;
    }

    /**
     * A Cloudbeds adapter for the property, with a valid (refreshed if needed)
     * access token. Empty when the property has no connected Cloudbeds account.
     */
    public Optional<CloudbedsAdapter> resolveAdapter(UUID merchantId) {
        return freshConnection(merchantId).map(this::adapterFor);
    }

    /**
     * Identifies the property behind a freshly-issued access token (OAuth
     * callback), before any connection row exists. Builds a throwaway adapter
     * with no bound propertyId and reads the first accessible property.
     */
    public PmsPropertyConfiguration identifyProperty(String accessToken) {
        CloudbedsAdapter adapter = new CloudbedsAdapter(
                config.getApiBaseUrl(), accessToken, null, chargeCapCents);
        return adapter.getPropertyConfiguration();
    }

    @Override
    public Optional<ChargeContext> resolve(UUID merchantId) {
        return freshConnection(merchantId)
                .map(conn -> new ChargeContext(
                        adapterFor(conn),
                        conn.currency() == null || conn.currency().isBlank()
                                ? DEFAULT_CURRENCY : conn.currency()));
    }

    private CloudbedsAdapter adapterFor(CloudbedsConnection conn) {
        return new CloudbedsAdapter(
                config.getApiBaseUrl(), conn.accessToken(), conn.propertyId(), chargeCapCents);
    }

    /**
     * Loads the property's connection and returns it with a valid access token,
     * refreshing (single-flight) if it is at/near expiry. Empty when there is no
     * connected row.
     */
    private Optional<CloudbedsConnection> freshConnection(UUID merchantId) {
        CloudbedsConnection conn = connectionDao.findByMerchant(merchantId).orElse(null);
        if (conn == null || !conn.isConnected()) {
            return Optional.empty();
        }
        if (!conn.needsRefresh(Instant.now(clock), REFRESH_SKEW)) {
            return Optional.of(conn);
        }
        return Optional.of(refreshSingleFlight(merchantId, conn));
    }

    private CloudbedsConnection refreshSingleFlight(UUID merchantId, CloudbedsConnection stale) {
        // One lock per merchant (bounded by merchant count); kept in the map so
        // every caller for this property serializes on the same monitor.
        Object lock = refreshLocks.computeIfAbsent(merchantId, k -> new Object());
        synchronized (lock) {
            // Double-check: another thread may have refreshed while we waited.
            CloudbedsConnection current = connectionDao.findByMerchant(merchantId).orElse(stale);
            if (!current.needsRefresh(Instant.now(clock), REFRESH_SKEW)) {
                return current;
            }
            try {
                CloudbedsTokens tokens = oauthClient.refresh(current.refreshToken());
                Instant expiresAt = Instant.now(clock).plusSeconds(tokens.expiresInSeconds());
                connectionDao.updateTokens(
                        merchantId, tokens.accessToken(), tokens.refreshToken(), expiresAt);
                log.info("Refreshed Cloudbeds access token for merchant {} (expires {})",
                        merchantId, expiresAt);
                return connectionDao.findByMerchant(merchantId).orElse(current);
            } catch (CloudbedsOAuthException e) {
                // A permanently-failed refresh means re-authorization is needed.
                log.warn("Cloudbeds token refresh failed for merchant {}: {}", merchantId, e.getMessage());
                connectionDao.markRevoked(merchantId);
                throw e;
            }
        }
    }
}
