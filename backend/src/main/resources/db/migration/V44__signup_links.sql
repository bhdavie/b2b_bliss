-- A sign-in link for an email Bliss has no property for yet. The property is
-- created when the link is clicked, not when it is requested, so a submitted
-- address that is never confirmed leaves no row behind. The link carries the
-- email it was sent to and no subject id.
ALTER TABLE magic_link_tokens
    ADD COLUMN signup_email VARCHAR(255);

ALTER TABLE magic_link_tokens
    DROP CONSTRAINT magic_link_tokens_subject_type_chk;

ALTER TABLE magic_link_tokens
    ADD CONSTRAINT magic_link_tokens_subject_type_chk
        CHECK (subject_type IN ('merchant', 'customer', 'admin', 'signup'));

ALTER TABLE magic_link_tokens
    DROP CONSTRAINT magic_link_tokens_subject_ref_chk;

ALTER TABLE magic_link_tokens
    ADD CONSTRAINT magic_link_tokens_subject_ref_chk
        CHECK (
            (subject_type = 'merchant'
                AND merchant_id IS NOT NULL AND customer_id IS NULL AND admin_user_id IS NULL
                AND signup_email IS NULL)
            OR
            (subject_type = 'customer'
                AND customer_id IS NOT NULL AND merchant_id IS NULL AND admin_user_id IS NULL
                AND signup_email IS NULL)
            OR
            (subject_type = 'admin'
                AND admin_user_id IS NOT NULL AND merchant_id IS NULL AND customer_id IS NULL
                AND signup_email IS NULL)
            OR
            (subject_type = 'signup'
                AND signup_email IS NOT NULL AND merchant_id IS NULL AND customer_id IS NULL
                AND admin_user_id IS NULL)
        );

-- The per-email cooldown looks up the latest link sent to an address.
CREATE INDEX magic_link_tokens_signup_email_idx ON magic_link_tokens (signup_email);
