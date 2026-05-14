-- Single-use, short-lived tokens for the magic-link sign-in flow. We hash the
-- raw token at rest so a DB compromise does not yield active session tokens.
-- The raw token only ever exists in the user's email (and dev logs).

CREATE TABLE magic_link_tokens (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id     UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    token_hash      VARCHAR(255) UNIQUE NOT NULL,
    expires_at      TIMESTAMPTZ NOT NULL,
    consumed_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX magic_link_tokens_merchant_id_idx ON magic_link_tokens(merchant_id);
CREATE INDEX magic_link_tokens_expires_at_idx ON magic_link_tokens(expires_at);
