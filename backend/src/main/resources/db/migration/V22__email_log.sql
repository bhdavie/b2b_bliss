-- Sent-email log for transactional guest notifications.
--
-- One row per (event, target) that has been sent, keyed by a natural dedupe key
-- like "receipt:{scheduleId}" or "plan_activated:{planId}". The PK gives an
-- atomic claim: the notification layer INSERTs ON CONFLICT DO NOTHING and only
-- sends when it wins the row, so a reconciliation retry (or any duplicate
-- lifecycle call) can never double-send a receipt. At-most-once by construction.
CREATE TABLE email_log (
    dedupe_key VARCHAR(255) PRIMARY KEY,
    email_type VARCHAR(64)  NOT NULL,
    recipient  VARCHAR(255),
    created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
