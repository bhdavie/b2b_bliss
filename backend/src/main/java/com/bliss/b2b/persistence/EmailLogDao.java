package com.bliss.b2b.persistence;

import org.jdbi.v3.sqlobject.customizer.Bind;
import org.jdbi.v3.sqlobject.statement.SqlUpdate;

/**
 * Idempotency ledger for transactional emails. {@link #claim} atomically records
 * a dedupe key and returns whether this caller won it; only the winner should
 * send, so a duplicate lifecycle call (e.g. a reconciliation retry) never
 * double-sends.
 */
public interface EmailLogDao {

    /**
     * Records the dedupe key if it is new. Returns the number of rows inserted:
     * {@code 1} means this caller claimed it (send now), {@code 0} means another
     * caller already did (skip).
     */
    @SqlUpdate("""
            INSERT INTO email_log (dedupe_key, email_type, recipient)
            VALUES (:dedupeKey, :emailType, :recipient)
            ON CONFLICT (dedupe_key) DO NOTHING
            """)
    int claim(
            @Bind("dedupeKey") String dedupeKey,
            @Bind("emailType") String emailType,
            @Bind("recipient") String recipient
    );
}
