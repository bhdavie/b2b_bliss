-- Bliss internal admin subject: a third portal alongside the merchant (property)
-- dashboard and the guest account.
--
-- Deliberately not a role flag on merchants. An admin is not a property that
-- happens to have extra rights: it has no slug, no bookings, no payout account
-- and no onboarding state, and every merchant-scoped query in the app filters by
-- merchant_id. Giving one merchant row god rights would make those filters lie.
-- A separate table keeps the merchant table meaning exactly what it means today.
--
-- One user for now, seeded below. There is no admin signup and no
-- find-or-create anywhere in the code: a row here is provisioned by hand, and
-- sign-in fails closed for any email that does not already match one.

CREATE TABLE admin_users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           VARCHAR(255) NOT NULL UNIQUE,
    name            VARCHAR(255),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login_at   TIMESTAMPTZ
);

INSERT INTO admin_users (email, name)
VALUES ('brad@bliss-payments.com', 'Brad Davies');

-- magic_link_tokens grows a third subject.
--
-- V25 made this table multi-subject for the guest portal and wrote the scoping
-- into the database rather than only into the queries: subject_type says which
-- kind of token a row is, and a CHECK requires exactly the matching id column to
-- be populated with the others NULL, so a row that could satisfy two lookups
-- cannot be written. That property is what is being preserved here; the ref
-- CHECK is an exhaustive OR over the subject types, so it has to be rewritten
-- rather than extended.
ALTER TABLE magic_link_tokens
    ADD COLUMN admin_user_id UUID REFERENCES admin_users(id) ON DELETE CASCADE;

ALTER TABLE magic_link_tokens
    DROP CONSTRAINT magic_link_tokens_subject_type_chk;

ALTER TABLE magic_link_tokens
    ADD CONSTRAINT magic_link_tokens_subject_type_chk
        CHECK (subject_type IN ('merchant', 'customer', 'admin'));

ALTER TABLE magic_link_tokens
    DROP CONSTRAINT magic_link_tokens_subject_ref_chk;

-- Three branches, each pinning exactly one id column non-null and the other two
-- NULL. Existing merchant and customer rows satisfy the first two branches
-- unchanged, because admin_user_id was just added and is NULL on every one.
ALTER TABLE magic_link_tokens
    ADD CONSTRAINT magic_link_tokens_subject_ref_chk
        CHECK (
            (subject_type = 'merchant'
                AND merchant_id IS NOT NULL
                AND customer_id IS NULL
                AND admin_user_id IS NULL)
            OR
            (subject_type = 'customer'
                AND customer_id IS NOT NULL
                AND merchant_id IS NULL
                AND admin_user_id IS NULL)
            OR
            (subject_type = 'admin'
                AND admin_user_id IS NOT NULL
                AND merchant_id IS NULL
                AND customer_id IS NULL)
        );

CREATE INDEX magic_link_tokens_admin_user_id_idx
    ON magic_link_tokens (admin_user_id);
