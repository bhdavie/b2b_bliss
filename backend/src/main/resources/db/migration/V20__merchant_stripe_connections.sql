-- Per-property Stripe Connect *Standard* accounts.
--
-- The existing Express integration (merchants.stripe_connect_account_id /
-- stripe_connect_status, added in V2) makes the platform the merchant of record
-- and pays connected accounts out via Transfers. This new rail is different: a
-- property connects its OWN Stripe *Standard* account and every charge for that
-- property runs as a direct charge on that account (Stripe-Account header), so
-- the property is the merchant of record. The two systems coexist; this table
-- holds only the Standard connection and leaves the Express columns untouched.
--
-- Structurally this mirrors merchant_mews_connections (V17): one row per
-- property, secrets/identifiers isolated in their own table rather than widened
-- onto merchants, so the per-property resolver reads it the same way the Mews
-- adapter factory reads its connection table.
--
-- No backfill. Existing properties (Marbrook, Hawthorn) keep running on their
-- current path with no row here; a property only gets a row once it starts
-- Standard onboarding.
CREATE TABLE merchant_stripe_connections (
    merchant_id       UUID PRIMARY KEY REFERENCES merchants(id) ON DELETE CASCADE,
    -- The connected Standard account (acct_...). One account per property, so a
    -- webhook can map an account back to exactly one property.
    stripe_account_id VARCHAR(255) NOT NULL UNIQUE,
    -- Onboarding status, using the same wire vocabulary as ConnectStatus:
    -- not_started, in_progress, charges_enabled, restricted.
    connect_status    VARCHAR(32) NOT NULL DEFAULT 'in_progress',
    -- Cached charges_enabled flag: the property can take direct charges once true.
    -- The per-property resolver gates on this so the pay flow never charges an
    -- account that has not finished onboarding.
    charges_enabled   BOOLEAN NOT NULL DEFAULT FALSE,
    -- First time charges_enabled flipped true (when onboarding completed).
    connected_at      TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER merchant_stripe_connections_set_updated_at
    BEFORE UPDATE ON merchant_stripe_connections
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
