package com.bliss.b2b.cli;

import com.bliss.b2b.BlissConfiguration;
import com.bliss.b2b.persistence.DatabaseUrlResolver;
import com.bliss.b2b.persistence.migration.V30__Encrypt_pms_connection_tokens;
import com.bliss.b2b.security.TokenCipher;
import io.dropwizard.core.cli.ConfiguredCommand;
import io.dropwizard.core.setup.Bootstrap;
import net.sourceforge.argparse4j.inf.Namespace;
import org.flywaydb.core.Flyway;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Applies the Flyway migrations and exits, without starting the server. The
 * same configuration the server uses on boot, including V30's Java migration,
 * which needs the application's token key and so cannot run from the Flyway
 * command line. CI uses it to migrate a fresh Postgres before the database
 * tests run.
 *
 * <pre>
 *   java -jar backend/target/bliss-b2b-backend.jar migrate backend/src/main/resources/config.yml
 * </pre>
 */
public class MigrateCommand extends ConfiguredCommand<BlissConfiguration> {

    private static final Logger log = LoggerFactory.getLogger(MigrateCommand.class);

    public MigrateCommand() {
        super("migrate", "Apply the database migrations and exit");
    }

    @Override
    protected void run(Bootstrap<BlissConfiguration> bootstrap, Namespace namespace,
            BlissConfiguration configuration) {
        // A command never runs BlissApplication.run(), so resolve the platform
        // DATABASE_URL here too, as SeedDemoCommand does.
        DatabaseUrlResolver.applyFromEnvironment(configuration.getDatabase());
        BlissConfiguration.DatabaseConfig db = configuration.getDatabase();
        TokenCipher cipher = TokenCipher.fromConfig(
                configuration.getTokenEncryptionKey(), configuration.isProduction());
        var result = Flyway.configure()
                .dataSource(db.getUrl(), db.getUser(), db.getPassword())
                .locations("classpath:db/migration")
                .javaMigrations(new V30__Encrypt_pms_connection_tokens(cipher))
                .load()
                .migrate();
        log.info("Applied {} migrations; schema now at {}", result.migrationsExecuted, result.targetSchemaVersion);
    }
}
