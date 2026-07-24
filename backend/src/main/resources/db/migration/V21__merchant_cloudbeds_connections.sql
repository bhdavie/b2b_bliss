-- Per-property Cloudbeds OAuth connections.
--
-- Mirrors merchant_mews_connections (V17) and merchant_stripe_connections (V20):
-- one row per property, secrets isolated in their own table, read per-property by
-- a resolver (CloudbedsAdapterFactory) exactly like the Mews adapter factory.
--
-- Unlike Mews (long-lived Connector tokens), Cloudbeds uses OAuth 2.0: an
-- access token valid ~8h and a refresh token that is effectively permanent
-- (365-day sliding inactivity window). The adapter/factory refreshes the access
-- token transparently near expiry and rewrites both tokens here.
--
-- DEMO NOTE: tokens are stored in plaintext, acceptable only for a demo. A
-- production build must encrypt these at rest or hold them in a secret manager.
--
-- No backfill. A property only gets a row once it completes Cloudbeds OAuth.
CREATE TABLE merchant_cloudbeds_connections (
    merchant_id     UUID PRIMARY KEY REFERENCES merchants(id) ON DELETE CASCADE,
    -- Cloudbeds propertyID identified from getHotels after authorization. One
    -- authorization can cover multiple properties; we store the primary one.
    property_id     VARCHAR(255) NOT NULL,
    property_name   VARCHAR(255),
    currency        VARCHAR(8),
    -- OAuth tokens. access_token_expires_at drives the transparent refresh.
    access_token    VARCHAR(2048) NOT NULL,
    refresh_token   VARCHAR(2048) NOT NULL,
    access_token_expires_at TIMESTAMPTZ NOT NULL,
    -- Connection lifecycle: 'connected' once tokens + property are stored,
    -- 'revoked' if a refresh permanently fails and re-authorization is needed.
    status          VARCHAR(32) NOT NULL DEFAULT 'connected',
    connected_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER merchant_cloudbeds_connections_set_updated_at
    BEFORE UPDATE ON merchant_cloudbeds_connections
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
