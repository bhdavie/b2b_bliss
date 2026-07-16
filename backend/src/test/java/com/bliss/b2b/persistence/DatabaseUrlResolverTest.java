package com.bliss.b2b.persistence;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.catchThrowable;

import com.bliss.b2b.BlissConfiguration.DatabaseConfig;
import org.junit.jupiter.api.Test;

/**
 * Covers the DATABASE_URL decomposition. Tests drive {@link
 * DatabaseUrlResolver#apply} rather than {@code applyFromEnvironment} — the two
 * differ only in where the string comes from, and the process environment
 * cannot be mutated from a test.
 */
class DatabaseUrlResolverTest {

    private static final String LOCAL_URL = "jdbc:postgresql://localhost:5432/bliss";
    private static final String LOCAL_USER = "bliss";
    private static final String LOCAL_PASSWORD = "bliss_dev";

    /** A config carrying the BLISS_DB_* values config.yml would have supplied. */
    private static DatabaseConfig localDevConfig() {
        DatabaseConfig config = new DatabaseConfig();
        config.setUrl(LOCAL_URL);
        config.setUser(LOCAL_USER);
        config.setPassword(LOCAL_PASSWORD);
        return config;
    }

    // -- The Heroku shape --

    @Test
    void standardUrl_decomposesToJdbcWithSslModeAndSeparateCredentials() {
        DatabaseConfig config = localDevConfig();

        DatabaseUrlResolver.apply(config, "postgres://someuser:s3cr3t@db.example.com:5432/blissprod");

        assertThat(config.getUrl())
                .isEqualTo("jdbc:postgresql://db.example.com:5432/blissprod?sslmode=require");
        assertThat(config.getUser()).isEqualTo("someuser");
        assertThat(config.getPassword()).isEqualTo("s3cr3t");
    }

    @Test
    void postgresqlScheme_isAlsoAccepted() {
        DatabaseConfig config = localDevConfig();

        DatabaseUrlResolver.apply(config, "postgresql://u:p@host.example.com:5432/db");

        assertThat(config.getUrl()).isEqualTo("jdbc:postgresql://host.example.com:5432/db?sslmode=require");
    }

    @Test
    void nonDefaultPort_isPreserved() {
        DatabaseConfig config = localDevConfig();

        DatabaseUrlResolver.apply(config, "postgres://u:p@db.example.com:5433/blissprod");

        assertThat(config.getUrl()).contains(":5433/blissprod");
    }

    @Test
    void omittedPort_defaultsTo5432() {
        DatabaseConfig config = localDevConfig();

        DatabaseUrlResolver.apply(config, "postgres://u:p@db.example.com/blissprod");

        assertThat(config.getUrl()).isEqualTo("jdbc:postgresql://db.example.com:5432/blissprod?sslmode=require");
    }

    // -- Credential decoding --

    @Test
    void percentEncodedCredentials_areDecoded() {
        // Add-ons percent-encode generated passwords containing reserved
        // characters. Hikari wants the decoded value, not the escaped one.
        DatabaseConfig config = localDevConfig();

        DatabaseUrlResolver.apply(config, "postgres://some%40user:s3cr3t%40pw%2Fslash@db.example.com:5432/blissprod");

        assertThat(config.getUser()).isEqualTo("some@user");
        assertThat(config.getPassword()).isEqualTo("s3cr3t@pw/slash");
    }

    @Test
    void passwordContainingColon_splitsOnFirstColonOnly() {
        DatabaseConfig config = localDevConfig();

        DatabaseUrlResolver.apply(config, "postgres://someuser:pa:ss:word@db.example.com:5432/blissprod");

        assertThat(config.getUser()).isEqualTo("someuser");
        assertThat(config.getPassword()).isEqualTo("pa:ss:word");
    }

    // -- Precedence over the BLISS_DB_* fallback --

    @Test
    void databaseUrlPresent_overridesBlissDbVars() {
        DatabaseConfig config = localDevConfig();

        DatabaseUrlResolver.apply(config, "postgres://someuser:s3cr3t@db.example.com:5432/blissprod");

        assertThat(config.getUrl()).doesNotContain("localhost");
        assertThat(config.getUser()).isNotEqualTo(LOCAL_USER);
        assertThat(config.getPassword()).isNotEqualTo(LOCAL_PASSWORD);
    }

    @Test
    void databaseUrlAbsent_leavesBlissDbVarsIntact() {
        DatabaseConfig config = localDevConfig();

        DatabaseUrlResolver.apply(config, null);

        assertThat(config.getUrl()).isEqualTo(LOCAL_URL);
        assertThat(config.getUser()).isEqualTo(LOCAL_USER);
        assertThat(config.getPassword()).isEqualTo(LOCAL_PASSWORD);
    }

    @Test
    void databaseUrlBlank_leavesBlissDbVarsIntact() {
        DatabaseConfig config = localDevConfig();

        DatabaseUrlResolver.apply(config, "   ");

        assertThat(config.getUrl()).isEqualTo(LOCAL_URL);
        assertThat(config.getUser()).isEqualTo(LOCAL_USER);
        assertThat(config.getPassword()).isEqualTo(LOCAL_PASSWORD);
    }

    @Test
    void runMigrationsFlag_isNotDisturbed() {
        DatabaseConfig config = localDevConfig();
        config.setRunMigrations(false);

        DatabaseUrlResolver.apply(config, "postgres://u:p@db.example.com:5432/blissprod");

        assertThat(config.isRunMigrations()).isFalse();
    }

    // -- Malformed input. The value carries a password, so nothing may echo it --

    @Test
    void malformedUri_throwsWithoutEchoingTheRawValue() {
        DatabaseConfig config = localDevConfig();

        assertThatThrownBy(() ->
                DatabaseUrlResolver.apply(config, "postgres://someuser:s3cr3tpw@ho st:5432/blissprod"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("DATABASE_URL is not a valid URI")
                .hasMessageNotContaining("s3cr3tpw");
    }

    @Test
    void malformedUri_doesNotLeakPasswordThroughTheCauseChain() {
        // URISyntaxException.getMessage() embeds its input, so attaching it as a
        // cause would put the password into any stack trace. Assert the whole
        // chain is clean, not just the top-level message.
        DatabaseConfig config = localDevConfig();

        Throwable thrown = catchThrowable(() ->
                DatabaseUrlResolver.apply(config, "postgres://someuser:s3cr3tpw@ho st:5432/blissprod"));

        for (Throwable t = thrown; t != null; t = t.getCause()) {
            assertThat(t.getMessage()).doesNotContain("s3cr3tpw");
        }
    }

    @Test
    void unsupportedScheme_throwsWithoutEchoingThePassword() {
        DatabaseConfig config = localDevConfig();

        assertThatThrownBy(() ->
                DatabaseUrlResolver.apply(config, "mysql://someuser:s3cr3tpw@db.example.com:3306/blissprod"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("must use the postgres:// or postgresql:// scheme")
                .hasMessageContaining("mysql")
                .hasMessageNotContaining("s3cr3tpw");
    }

    @Test
    void missingCredentials_throwsWithoutEchoingTheRawValue() {
        DatabaseConfig config = localDevConfig();

        assertThatThrownBy(() -> DatabaseUrlResolver.apply(config, "postgres://db.example.com:5432/blissprod"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("missing user credentials")
                .hasMessageNotContaining("db.example.com");
    }

    @Test
    void missingDatabaseName_throws() {
        DatabaseConfig config = localDevConfig();

        assertThatThrownBy(() ->
                DatabaseUrlResolver.apply(config, "postgres://someuser:s3cr3tpw@db.example.com:5432"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("missing a database name")
                .hasMessageNotContaining("s3cr3tpw");
    }

    @Test
    void malformedInput_leavesConfigUntouched() {
        // A throw must not leave the config half-rewritten.
        DatabaseConfig config = localDevConfig();

        assertThatThrownBy(() -> DatabaseUrlResolver.apply(config, "mysql://u:p@host:3306/db"))
                .isInstanceOf(IllegalArgumentException.class);

        assertThat(config.getUrl()).isEqualTo(LOCAL_URL);
        assertThat(config.getUser()).isEqualTo(LOCAL_USER);
        assertThat(config.getPassword()).isEqualTo(LOCAL_PASSWORD);
    }
}
