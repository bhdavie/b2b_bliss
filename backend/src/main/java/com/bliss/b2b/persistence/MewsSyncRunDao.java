package com.bliss.b2b.persistence;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.jdbi.v3.sqlobject.config.RegisterConstructorMapper;
import org.jdbi.v3.sqlobject.customizer.Bind;
import org.jdbi.v3.sqlobject.statement.SqlQuery;
import org.jdbi.v3.sqlobject.statement.SqlUpdate;

public interface MewsSyncRunDao {

    @SqlUpdate("""
            INSERT INTO mews_sync_runs (merchant_id, started_at, finished_at, changes, error)
            VALUES (:merchantId, :startedAt, :finishedAt, CAST(:changes AS jsonb), :error)
            """)
    int record(@Bind("merchantId") UUID merchantId, @Bind("startedAt") Instant startedAt,
            @Bind("finishedAt") Instant finishedAt, @Bind("changes") String changesJson,
            @Bind("error") String error);

    @SqlQuery("""
            SELECT started_at AS startedAt, finished_at AS finishedAt, changes::text AS changesJson, error
            FROM mews_sync_runs WHERE merchant_id = :merchantId ORDER BY started_at DESC LIMIT 1
            """)
    @RegisterConstructorMapper(SyncRun.class)
    Optional<SyncRun> latest(@Bind("merchantId") UUID merchantId);

    record SyncRun(Instant startedAt, Instant finishedAt, String changesJson, String error) {
    }
}
