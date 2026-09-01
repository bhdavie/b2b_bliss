-- Scope magic-link tokens to a subject type so guest sign-in can reuse this
-- table without a guest token ever resolving to a merchant, or the reverse.
--
-- V3 created magic_link_tokens with a NOT NULL merchant_id, which made the
-- table merchant-only by construction. Guest sign-in needs the same primitives
-- (single-use hashed token, TTL, consumed_at), so rather than stand up a second
-- table with a second set of expiry and consume semantics to keep in step, the
-- existing one grows a subject.
--
-- The scoping is enforced by the database, not only by the queries: subject_type
-- says which kind of token this is, and a CHECK requires exactly the matching id
-- column to be populated and the other to be NULL. A row that could satisfy both
-- lookups cannot be written. The DAO then filters on subject_type as well, so a
-- token forged or leaked across surfaces fails at the query too.

ALTER TABLE magic_link_tokens
    ADD COLUMN customer_id UUID REFERENCES customers(id) ON DELETE CASCADE;

-- Existing rows are all merchant links, so the default backfills them correctly
-- and no data migration is needed.
ALTER TABLE magic_link_tokens
    ADD COLUMN subject_type VARCHAR(16) NOT NULL DEFAULT 'merchant';

-- merchant_id has to become nullable for a customer row to exist at all. The
-- CHECK below is what stops it being null on a merchant row.
ALTER TABLE magic_link_tokens
    ALTER COLUMN merchant_id DROP NOT NULL;

ALTER TABLE magic_link_tokens
    ADD CONSTRAINT magic_link_tokens_subject_type_chk
        CHECK (subject_type IN ('merchant', 'customer'));

ALTER TABLE magic_link_tokens
    ADD CONSTRAINT magic_link_tokens_subject_ref_chk
        CHECK (
            (subject_type = 'merchant' AND merchant_id IS NOT NULL AND customer_id IS NULL)
            OR
            (subject_type = 'customer' AND customer_id IS NOT NULL AND merchant_id IS NULL)
        );

CREATE INDEX magic_link_tokens_customer_id_idx
    ON magic_link_tokens (customer_id);
