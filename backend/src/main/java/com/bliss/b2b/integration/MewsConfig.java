package com.bliss.b2b.integration;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Minimal loader for Mews credentials out of a {@code .env} file in the backend
 * working directory, falling back to real environment variables.
 *
 * <p>Deliberately hand-rolled rather than pulling in a dotenv dependency — we
 * only need three keys and CLAUDE.md asks that new dependencies be flagged. The
 * file is parsed once at construction; keys are {@code KEY=VALUE} per line,
 * {@code #} comments and blank lines ignored.
 *
 * <p>Mews is on the v2 "out of v1" integration list; this is wired in for the
 * demo only.
 */
public class MewsConfig {

    private static final Logger log = LoggerFactory.getLogger(MewsConfig.class);

    private static final String DEFAULT_PLATFORM_URL = "https://api.mews-demo.com";

    private final String platformUrl;
    private final String clientToken;
    private final String accessToken;

    public MewsConfig(String platformUrl, String clientToken, String accessToken) {
        this.platformUrl = (platformUrl == null || platformUrl.isBlank())
                ? DEFAULT_PLATFORM_URL : stripTrailingSlash(platformUrl);
        this.clientToken = clientToken;
        this.accessToken = accessToken;
    }

    /** Loads from {@code ./.env} then the process environment (env wins if set). */
    public static MewsConfig load() {
        return load(Path.of(".env"));
    }

    static MewsConfig load(Path envFile) {
        Map<String, String> values = readEnvFile(envFile);
        return new MewsConfig(
                resolve(values, "MEWS_PLATFORM_URL"),
                resolve(values, "MEWS_CLIENT_TOKEN"),
                resolve(values, "MEWS_ACCESS_TOKEN"));
    }

    private static String resolve(Map<String, String> fileValues, String key) {
        String fromEnv = System.getenv(key);
        if (fromEnv != null && !fromEnv.isBlank()) {
            return fromEnv;
        }
        return fileValues.get(key);
    }

    private static Map<String, String> readEnvFile(Path envFile) {
        Map<String, String> out = new HashMap<>();
        if (!Files.exists(envFile)) {
            log.info("No {} found; relying on process environment for Mews config", envFile);
            return out;
        }
        try {
            for (String raw : Files.readAllLines(envFile)) {
                String line = raw.strip();
                if (line.isEmpty() || line.startsWith("#")) {
                    continue;
                }
                int eq = line.indexOf('=');
                if (eq <= 0) {
                    continue;
                }
                String key = line.substring(0, eq).strip();
                String value = line.substring(eq + 1).strip();
                out.put(key, value);
            }
        } catch (IOException e) {
            log.warn("Failed to read {}: {}", envFile, e.getMessage());
        }
        return out;
    }

    private static String stripTrailingSlash(String url) {
        return url.endsWith("/") ? url.substring(0, url.length() - 1) : url;
    }

    public boolean isConfigured() {
        return clientToken != null && !clientToken.isBlank()
                && accessToken != null && !accessToken.isBlank();
    }

    public String platformUrl() {
        return platformUrl;
    }

    public String clientToken() {
        return clientToken;
    }

    public String accessToken() {
        return accessToken;
    }
}
