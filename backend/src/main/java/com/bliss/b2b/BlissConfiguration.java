package com.bliss.b2b;

import com.fasterxml.jackson.annotation.JsonProperty;
import io.dropwizard.core.Configuration;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

public class BlissConfiguration extends Configuration {

    @NotBlank
    private String env = "development";

    /**
     * Keeps the password-less demo sign-in available under
     * {@code BLISS_ENV=production}. Scoped to auth: it re-opens
     * {@code POST /api/v1/auth/dev-login} (and so the funnel and Mews demo
     * flows that call it) and nothing else. Every other production rule —
     * secure cookies, the JWT secret guard, short expiries, dev plan endpoints
     * staying shut — is unaffected.
     *
     * <p>Off by default, so a deploy is strict unless it opts in. Turning it off
     * once Postmark is configured leaves magic link as the only way in, with no
     * code change: the sign-in page reads {@code GET /api/v1/auth/dev-status}
     * and renders whichever path is live.
     */
    private boolean demoLogin = false;

    @Valid
    @NotNull
    private AppConfig app = new AppConfig();

    @Valid
    @NotNull
    private DatabaseConfig database = new DatabaseConfig();

    @Valid
    @NotNull
    private JwtConfig jwt = new JwtConfig();

    @Valid
    @NotNull
    private SentryConfig sentry = new SentryConfig();

    @Valid
    @NotNull
    private CorsConfig cors = new CorsConfig();

    @Valid
    @NotNull
    private CookieConfig cookies = new CookieConfig();

    @Valid
    @NotNull
    private EmailConfig email = new EmailConfig();

    @Valid
    @NotNull
    private StripeConfig stripe = new StripeConfig();

    @Valid
    @NotNull
    private PmsConfig pms = new PmsConfig();

    @JsonProperty public String getEnv() { return env; }
    @JsonProperty public void setEnv(String env) { this.env = env; }
    @JsonProperty public boolean isDemoLogin() { return demoLogin; }
    @JsonProperty public void setDemoLogin(boolean demoLogin) { this.demoLogin = demoLogin; }
    @JsonProperty public AppConfig getApp() { return app; }
    @JsonProperty public void setApp(AppConfig app) { this.app = app; }
    @JsonProperty public DatabaseConfig getDatabase() { return database; }
    @JsonProperty public void setDatabase(DatabaseConfig database) { this.database = database; }
    @JsonProperty public JwtConfig getJwt() { return jwt; }
    @JsonProperty public void setJwt(JwtConfig jwt) { this.jwt = jwt; }
    @JsonProperty public SentryConfig getSentry() { return sentry; }
    @JsonProperty public void setSentry(SentryConfig sentry) { this.sentry = sentry; }
    @JsonProperty public CorsConfig getCors() { return cors; }
    @JsonProperty public void setCors(CorsConfig cors) { this.cors = cors; }
    @JsonProperty public CookieConfig getCookies() { return cookies; }
    @JsonProperty public void setCookies(CookieConfig cookies) { this.cookies = cookies; }
    @JsonProperty public EmailConfig getEmail() { return email; }
    @JsonProperty public void setEmail(EmailConfig email) { this.email = email; }
    @JsonProperty public StripeConfig getStripe() { return stripe; }
    @JsonProperty public void setStripe(StripeConfig stripe) { this.stripe = stripe; }
    @JsonProperty public PmsConfig getPms() { return pms; }
    @JsonProperty public void setPms(PmsConfig pms) { this.pms = pms; }

    public boolean isProduction() {
        return "production".equalsIgnoreCase(env);
    }

    /**
     * Base urls for the two frontend surfaces. Production serves them from
     * separate hostnames — the merchant dashboard on property.bliss-payments.com
     * and the consumer portal on guest.bliss-payments.com — so a link's audience
     * decides which value builds it. Local dev points both at the one Next dev
     * server, where every route is served from a single origin.
     */
    public static class AppConfig {
        @NotBlank
        private String merchantBaseUrl = "http://localhost:3000";

        @NotBlank
        private String consumerBaseUrl = "http://localhost:3000";

        @JsonProperty public String getMerchantBaseUrl() { return merchantBaseUrl; }
        @JsonProperty public void setMerchantBaseUrl(String merchantBaseUrl) { this.merchantBaseUrl = merchantBaseUrl; }
        @JsonProperty public String getConsumerBaseUrl() { return consumerBaseUrl; }
        @JsonProperty public void setConsumerBaseUrl(String consumerBaseUrl) { this.consumerBaseUrl = consumerBaseUrl; }
    }

    public static class CookieConfig {
        private String sameSite = "Lax";
        private String domain = "";

        @JsonProperty public String getSameSite() { return sameSite; }
        @JsonProperty public void setSameSite(String sameSite) { this.sameSite = sameSite; }
        @JsonProperty public String getDomain() { return domain; }
        @JsonProperty public void setDomain(String domain) { this.domain = domain; }
    }

    public static class DatabaseConfig {
        @NotBlank private String url = "jdbc:postgresql://localhost:5432/bliss";
        @NotBlank private String user = "bliss";
        @NotBlank private String password = "bliss_dev";
        private boolean runMigrations = true;

        @JsonProperty public String getUrl() { return url; }
        @JsonProperty public void setUrl(String url) { this.url = url; }
        @JsonProperty public String getUser() { return user; }
        @JsonProperty public void setUser(String user) { this.user = user; }
        @JsonProperty public String getPassword() { return password; }
        @JsonProperty public void setPassword(String password) { this.password = password; }
        @JsonProperty public boolean isRunMigrations() { return runMigrations; }
        @JsonProperty public void setRunMigrations(boolean runMigrations) { this.runMigrations = runMigrations; }
    }

    public static class JwtConfig {
        @NotBlank private String secret = "dev-secret-change-me-dev-secret-change-me";
        @NotBlank private String issuer = "bliss-b2b";
        @Min(1) private int ttlMinutes = 60;

        @JsonProperty public String getSecret() { return secret; }
        @JsonProperty public void setSecret(String secret) { this.secret = secret; }
        @JsonProperty public String getIssuer() { return issuer; }
        @JsonProperty public void setIssuer(String issuer) { this.issuer = issuer; }
        @JsonProperty public int getTtlMinutes() { return ttlMinutes; }
        @JsonProperty public void setTtlMinutes(int ttlMinutes) { this.ttlMinutes = ttlMinutes; }
    }

    public static class CorsConfig {
        @NotBlank private String allowedOrigins = "http://localhost:3000";

        @JsonProperty public String getAllowedOrigins() { return allowedOrigins; }
        @JsonProperty public void setAllowedOrigins(String allowedOrigins) { this.allowedOrigins = allowedOrigins; }
    }

    public static class SentryConfig {
        private String dsn = "";
        private String environment = "development";
        private String release = "unknown";
        private double tracesSampleRate = 0.0;

        @JsonProperty public String getDsn() { return dsn; }
        @JsonProperty public void setDsn(String dsn) { this.dsn = dsn; }
        @JsonProperty public String getEnvironment() { return environment; }
        @JsonProperty public void setEnvironment(String environment) { this.environment = environment; }
        @JsonProperty public String getRelease() { return release; }
        @JsonProperty public void setRelease(String release) { this.release = release; }
        @JsonProperty public double getTracesSampleRate() { return tracesSampleRate; }
        @JsonProperty public void setTracesSampleRate(double tracesSampleRate) { this.tracesSampleRate = tracesSampleRate; }
    }

    public static class EmailConfig {
        private String postmarkToken = "";
        private String fromAddress = "no-reply@bliss.com";

        @JsonProperty public String getPostmarkToken() { return postmarkToken; }
        @JsonProperty public void setPostmarkToken(String postmarkToken) { this.postmarkToken = postmarkToken; }
        @JsonProperty public String getFromAddress() { return fromAddress; }
        @JsonProperty public void setFromAddress(String fromAddress) { this.fromAddress = fromAddress; }
    }

    public static class StripeConfig {
        private String secretKey = "";
        private String publishableKey = "";
        private String webhookSecret = "";

        @JsonProperty public String getSecretKey() { return secretKey; }
        @JsonProperty public void setSecretKey(String secretKey) { this.secretKey = secretKey; }
        @JsonProperty public String getPublishableKey() { return publishableKey; }
        @JsonProperty public void setPublishableKey(String publishableKey) { this.publishableKey = publishableKey; }
        @JsonProperty public String getWebhookSecret() { return webhookSecret; }
        @JsonProperty public void setWebhookSecret(String webhookSecret) { this.webhookSecret = webhookSecret; }

        public boolean isConfigured() {
            return secretKey != null && !secretKey.isBlank();
        }
    }

    /**
     * PMS-native rails. Distinct from the reservation-sync Mews integration
     * (which loads its own credentials from {@code .env} via
     * {@link com.bliss.b2b.integration.MewsConfig}); this block feeds the
     * {@link com.bliss.b2b.integration.pms.PmsAdapter} and follows the same
     * Dropwizard config pattern as {@link StripeConfig}. Nested per provider so
     * a second PMS is a new sub-block, not more flat fields.
     */
    public static class PmsConfig {
        @Valid
        @NotNull
        private MewsPmsConfig mews = new MewsPmsConfig();

        @JsonProperty public MewsPmsConfig getMews() { return mews; }
        @JsonProperty public void setMews(MewsPmsConfig mews) { this.mews = mews; }

        public static class MewsPmsConfig {
            // Public Mews demo credentials for the Gross pricing UK demo
            // property (the "Are you ready to integrate with Mews?" client).
            // docs.mews.com states demo environments are completely public and
            // must never hold real data, so these are safe to commit as
            // defaults. Override platformUrl/clientToken/accessToken via
            // config.yml or MEWS_* environment for any real property.
            private String platformUrl = "https://api.mews-demo.com";
            private String clientToken = "E0D439EE522F44368DC78E1BFB03710C-D24FB11DBE31D4621C4817E028D9E1D";
            private String accessToken = "C66EF7B239D24632943D115EDE9CB810-EA00F8FD8294692C940F6B5A8F9453D";

            @JsonProperty public String getPlatformUrl() { return platformUrl; }
            @JsonProperty public void setPlatformUrl(String platformUrl) { this.platformUrl = platformUrl; }
            @JsonProperty public String getClientToken() { return clientToken; }
            @JsonProperty public void setClientToken(String clientToken) { this.clientToken = clientToken; }
            @JsonProperty public String getAccessToken() { return accessToken; }
            @JsonProperty public void setAccessToken(String accessToken) { this.accessToken = accessToken; }

            public boolean isConfigured() {
                return clientToken != null && !clientToken.isBlank()
                        && accessToken != null && !accessToken.isBlank();
            }
        }
    }
}
