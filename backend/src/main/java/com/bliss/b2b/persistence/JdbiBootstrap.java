package com.bliss.b2b.persistence;

import com.bliss.b2b.BlissConfiguration.DatabaseConfig;
import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import io.dropwizard.core.setup.Environment;
import io.dropwizard.lifecycle.Managed;
import org.jdbi.v3.core.Jdbi;
import org.jdbi.v3.postgres.PostgresPlugin;
import org.jdbi.v3.sqlobject.SqlObjectPlugin;

public final class JdbiBootstrap {

    private JdbiBootstrap() {}

    public static Jdbi build(DatabaseConfig config, Environment environment) {
        HikariConfig hk = new HikariConfig();
        hk.setJdbcUrl(config.getUrl());
        hk.setUsername(config.getUser());
        hk.setPassword(config.getPassword());
        hk.setMaximumPoolSize(8);
        hk.setMinimumIdle(2);
        hk.setPoolName("bliss-db");
        // -1 keeps app boot resilient when Postgres isn't reachable yet (tests,
        // local startup race against `brew services start`). Real queries still
        // fail at call time; this only affects pool initialization.
        hk.setInitializationFailTimeout(-1);

        HikariDataSource ds = new HikariDataSource(hk);
        environment.lifecycle().manage(new Managed() {
            @Override public void start() {}
            @Override public void stop() { ds.close(); }
        });

        Jdbi jdbi = Jdbi.create(ds)
                .installPlugin(new SqlObjectPlugin())
                .installPlugin(new PostgresPlugin());
        return jdbi;
    }
}
