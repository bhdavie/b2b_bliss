-- Hotel self-serve onboarding + per-property PMS selection and credentials.
-- Additive only: new columns (with defaults) and one new table. No existing
-- column is altered in place.
--
-- A property now carries:
--   pms_type          which rail it runs on: stripe (default), mews, cloudbeds
--   onboarding_state   resumable setup progress; the dashboard shows a checklist
--                      until 'active'
-- and, when it connects Mews, a row in merchant_mews_connections holding the
-- Connector tokens it entered plus the enterprise identity we read back on a
-- successful validation.

ALTER TABLE merchants
    ADD COLUMN pms_type VARCHAR(32) NOT NULL DEFAULT 'stripe';
ALTER TABLE merchants
    ADD CONSTRAINT merchants_pms_type_chk
        CHECK (pms_type IN ('stripe', 'mews', 'cloudbeds'));

ALTER TABLE merchants
    ADD COLUMN onboarding_state VARCHAR(32) NOT NULL DEFAULT 'created';
ALTER TABLE merchants
    ADD CONSTRAINT merchants_onboarding_state_chk
        CHECK (onboarding_state IN
               ('created', 'pms_selected', 'pms_connected', 'policy_set', 'active'));

-- Per-property Mews Connector credentials. One row per merchant. Secrets are
-- isolated in their own table rather than widened onto merchants.
--
-- DEMO NOTE: tokens are stored in plaintext. That is acceptable here because the
-- only tokens used are Mews's public demo credentials. A production build must
-- encrypt these at rest (or hold them in a secret manager) rather than in
-- readable columns.
CREATE TABLE merchant_mews_connections (
    merchant_id     UUID PRIMARY KEY REFERENCES merchants(id) ON DELETE CASCADE,
    platform_url    VARCHAR(255) NOT NULL,
    client_token    VARCHAR(255) NOT NULL,
    access_token    VARCHAR(255) NOT NULL,
    enterprise_id   VARCHAR(255),
    enterprise_name VARCHAR(255),
    currency        VARCHAR(8),
    validated_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER merchant_mews_connections_set_updated_at
    BEFORE UPDATE ON merchant_mews_connections
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- One-time backfill: every property that already exists predates onboarding and
-- should land straight on the dashboard, not into a setup checklist. New rows
-- created after this migration take the column default 'created'.
UPDATE merchants SET onboarding_state = 'active';
