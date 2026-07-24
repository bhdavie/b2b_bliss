package com.bliss.b2b.integration.cloudbeds;

import com.bliss.b2b.BlissConfiguration.PmsConfig.CloudbedsPmsConfig;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Cloudbeds OAuth 2.0 client: builds the authorize URL and exchanges/refreshes
 * tokens against the {@code access_token} endpoint. JDK {@link HttpClient} +
 * Jackson, form-urlencoded POST — same no-extra-dependency style as
 * {@link com.bliss.b2b.integration.pms.MewsAdapter}.
 *
 * <p>Per the docs: access token ~8h; refresh token effectively permanent
 * (365-day sliding inactivity) and may be rotated on refresh, so callers persist
 * whatever {@link CloudbedsTokens} comes back.
 */
public class CloudbedsOAuthClient {

    private static final Logger log = LoggerFactory.getLogger(CloudbedsOAuthClient.class);

    private final CloudbedsPmsConfig config;
    private final HttpClient http;
    private final ObjectMapper mapper;

    public CloudbedsOAuthClient(CloudbedsPmsConfig config) {
        this(config,
                HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build(),
                new ObjectMapper());
    }

    CloudbedsOAuthClient(CloudbedsPmsConfig config, HttpClient http, ObjectMapper mapper) {
        this.config = config;
        this.http = http;
        this.mapper = mapper;
    }

    public boolean isConfigured() {
        return config.isConfigured();
    }

    /**
     * Builds the Cloudbeds authorize URL the merchant is sent to. {@code state}
     * is echoed back to the callback and must be verified there (CSRF + merchant
     * binding).
     */
    public String buildAuthorizeUrl(String state) {
        Map<String, String> params = new LinkedHashMap<>();
        params.put("client_id", config.getClientId());
        params.put("redirect_uri", config.getRedirectUri());
        params.put("response_type", "code");
        params.put("scope", config.getScopes());
        params.put("state", state);
        return config.getAuthorizeUrl() + "?" + formEncode(params);
    }

    /** Exchanges an authorization code for tokens (grant_type=authorization_code). */
    public CloudbedsTokens exchangeCode(String code) {
        Map<String, String> body = new LinkedHashMap<>();
        body.put("grant_type", "authorization_code");
        body.put("client_id", config.getClientId());
        body.put("client_secret", config.getClientSecret());
        body.put("redirect_uri", config.getRedirectUri());
        body.put("code", code);
        return parseTokens(postForm(config.getTokenUrl(), body));
    }

    /** Refreshes an access token (grant_type=refresh_token). May rotate the refresh token. */
    public CloudbedsTokens refresh(String refreshToken) {
        Map<String, String> body = new LinkedHashMap<>();
        body.put("grant_type", "refresh_token");
        body.put("client_id", config.getClientId());
        body.put("client_secret", config.getClientSecret());
        body.put("refresh_token", refreshToken);
        CloudbedsTokens tokens = parseTokens(postForm(config.getTokenUrl(), body));
        // Cloudbeds may omit refresh_token on refresh; keep the prior one if so.
        if (tokens.refreshToken() == null || tokens.refreshToken().isBlank()) {
            return new CloudbedsTokens(
                    tokens.accessToken(), refreshToken,
                    tokens.expiresInSeconds(), tokens.tokenType());
        }
        return tokens;
    }

    private CloudbedsTokens parseTokens(JsonNode root) {
        String accessToken = textOrNull(root, "access_token");
        if (accessToken == null || accessToken.isBlank()) {
            throw new CloudbedsOAuthException(
                    "Cloudbeds token response had no access_token: " + truncate(root.toString()));
        }
        long expiresIn = root.path("expires_in").asLong(28800L); // default 8h
        return new CloudbedsTokens(
                accessToken,
                textOrNull(root, "refresh_token"),
                expiresIn,
                textOrNull(root, "token_type"));
    }

    private JsonNode postForm(String url, Map<String, String> form) {
        if (!isConfigured()) {
            throw new CloudbedsOAuthException(
                    "Cloudbeds OAuth is not configured (set CLOUDBEDS_CLIENT_ID / CLOUDBEDS_CLIENT_SECRET)");
        }
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(url))
                .timeout(Duration.ofSeconds(30))
                .header("Content-Type", "application/x-www-form-urlencoded")
                .header("Accept", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(formEncode(form)))
                .build();
        HttpResponse<String> response;
        try {
            response = http.send(request, HttpResponse.BodyHandlers.ofString());
        } catch (IOException e) {
            throw new CloudbedsOAuthException("Failed to reach Cloudbeds token endpoint: " + e.getMessage(), e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new CloudbedsOAuthException("Interrupted calling Cloudbeds token endpoint", e);
        }
        if (response.statusCode() / 100 != 2) {
            throw new CloudbedsOAuthException(
                    "Cloudbeds token endpoint returned HTTP " + response.statusCode()
                            + ": " + truncate(response.body()));
        }
        try {
            return mapper.readTree(response.body());
        } catch (IOException e) {
            throw new CloudbedsOAuthException("Could not parse Cloudbeds token response: " + e.getMessage(), e);
        }
    }

    private static String formEncode(Map<String, String> params) {
        StringBuilder sb = new StringBuilder();
        for (Map.Entry<String, String> e : params.entrySet()) {
            if (sb.length() > 0) sb.append('&');
            sb.append(URLEncoder.encode(e.getKey(), StandardCharsets.UTF_8))
                    .append('=')
                    .append(URLEncoder.encode(e.getValue() == null ? "" : e.getValue(), StandardCharsets.UTF_8));
        }
        return sb.toString();
    }

    private static String textOrNull(JsonNode node, String field) {
        JsonNode v = node.path(field);
        return v.isMissingNode() || v.isNull() ? null : v.asText();
    }

    private static String truncate(String body) {
        if (body == null) return "";
        return body.length() > 500 ? body.substring(0, 500) + "..." : body;
    }

    /** Thrown on any OAuth transport/protocol failure. */
    public static class CloudbedsOAuthException extends RuntimeException {
        public CloudbedsOAuthException(String message) { super(message); }
        public CloudbedsOAuthException(String message, Throwable cause) { super(message, cause); }
    }
}
