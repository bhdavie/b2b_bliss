package com.bliss.b2b.persistence;

import com.bliss.b2b.BlissConfiguration.DatabaseConfig;
import java.net.URI;
import java.net.URISyntaxException;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Decomposes a platform-supplied {@code DATABASE_URL} into the JDBC url plus
 * separate user and password that Dropwizard's DatabaseConfig expects.
 *
 * <p>Heroku (and most PaaS Postgres add-ons) inject a single credential-bearing
 * url in libpq form:
 * {@code postgres://user:pass@host:5432/dbname}. The JDBC driver cannot take
 * that directly, so this splits it into
 * {@code jdbc:postgresql://host:5432/dbname?sslmode=require} + user + password.
 *
 * <p>When {@code DATABASE_URL} is absent — local dev — nothing is touched and
 * the BLISS_DB_URL / BLISS_DB_USER / BLISS_DB_PASSWORD values from config.yml
 * stand. When it is present it wins, because the add-on rotates those
 * credentials and the env var is the only source that stays correct.
 */
public final class DatabaseUrlResolver {

    private static final Logger log = LoggerFactory.getLogger(DatabaseUrlResolver.class);

    private static final String ENV_VAR = "DATABASE_URL";
    private static final int DEFAULT_PORT = 5432;

    private DatabaseUrlResolver() {}

    /** Applies {@code DATABASE_URL} from the process environment, if set. */
    public static void applyFromEnvironment(DatabaseConfig config) {
        apply(config, System.getenv(ENV_VAR));
    }

    /**
     * Applies {@code databaseUrl} to {@code config}, overriding url/user/password.
     * A null or blank url is a no-op. A malformed one throws, rather than
     * silently falling back to the local-dev defaults and producing a confusing
     * connection error later in boot.
     */
    public static void apply(DatabaseConfig config, String databaseUrl) {
        if (databaseUrl == null || databaseUrl.isBlank()) {
            log.info("{} not set; using database config from config.yml", ENV_VAR);
            return;
        }

        URI uri = parse(databaseUrl.trim());
        requireSupportedScheme(uri);

        String host = uri.getHost();
        if (host == null || host.isBlank()) {
            throw new IllegalArgumentException(ENV_VAR + " is missing a host");
        }
        String database = uri.getPath() == null ? "" : uri.getPath().replaceFirst("^/", "");
        if (database.isBlank()) {
            throw new IllegalArgumentException(ENV_VAR + " is missing a database name");
        }
        int port = uri.getPort() == -1 ? DEFAULT_PORT : uri.getPort();

        String[] credentials = splitUserInfo(uri.getUserInfo());

        config.setUrl("jdbc:postgresql://" + host + ":" + port + "/" + database + "?sslmode=require");
        config.setUser(credentials[0]);
        config.setPassword(credentials[1]);

        log.info("{} applied; database url={}:{}/{} user={}", ENV_VAR, host, port, database, credentials[0]);
    }

    private static URI parse(String databaseUrl) {
        try {
            return new URI(databaseUrl);
        } catch (URISyntaxException e) {
            // Reason only, and deliberately no cause: the raw value carries the
            // password, and URISyntaxException.getMessage() embeds its input —
            // attaching it would leak the credential into any stack trace.
            throw new IllegalArgumentException(ENV_VAR + " is not a valid URI: " + e.getReason());
        }
    }

    private static void requireSupportedScheme(URI uri) {
        String scheme = uri.getScheme();
        if (!"postgres".equalsIgnoreCase(scheme) && !"postgresql".equalsIgnoreCase(scheme)) {
            throw new IllegalArgumentException(
                    ENV_VAR + " must use the postgres:// or postgresql:// scheme, got: " + scheme);
        }
    }

    /**
     * Splits {@code user:password} userinfo. Both halves are percent-decoded —
     * add-on generated passwords are url-encoded when they contain reserved
     * characters, and Hikari wants the decoded value.
     */
    private static String[] splitUserInfo(String userInfo) {
        if (userInfo == null || userInfo.isBlank()) {
            throw new IllegalArgumentException(ENV_VAR + " is missing user credentials");
        }
        int separator = userInfo.indexOf(':');
        String user = separator < 0 ? userInfo : userInfo.substring(0, separator);
        String password = separator < 0 ? "" : userInfo.substring(separator + 1);
        return new String[] {decode(user), decode(password)};
    }

    private static String decode(String value) {
        return URLDecoder.decode(value, StandardCharsets.UTF_8);
    }
}
