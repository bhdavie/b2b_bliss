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
    private EmailConfig email = new EmailConfig();

    @Valid
    @NotNull
    private StripeConfig stripe = new StripeConfig();

    @JsonProperty public String getEnv() { return env; }
    @JsonProperty public void setEnv(String env) { this.env = env; }
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
    @JsonProperty public EmailConfig getEmail() { return email; }
    @JsonProperty public void setEmail(EmailConfig email) { this.email = email; }
    @JsonProperty public StripeConfig getStripe() { return stripe; }
    @JsonProperty public void setStripe(StripeConfig stripe) { this.stripe = stripe; }

    public boolean isProduction() {
        return "production".equalsIgnoreCase(env);
    }

    public static class AppConfig {
        @NotBlank
        private String frontendBaseUrl = "http://localhost:3000";

        @JsonProperty public String getFrontendBaseUrl() { return frontendBaseUrl; }
        @JsonProperty public void setFrontendBaseUrl(String frontendBaseUrl) { this.frontendBaseUrl = frontendBaseUrl; }
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
}
