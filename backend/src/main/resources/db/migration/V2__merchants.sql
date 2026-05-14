-- Phase 1: merchant account holder. business_name and business_type are
-- nullable initially (filled in during the onboarding wizard after email
-- verification). password_hash from docs/data-model.md is omitted: v1 auth is
-- magic-link only. EIN, banking, KYB go to Stripe Connect Express (Phase 2).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE merchants (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug                        VARCHAR(64) UNIQUE NOT NULL,
    business_name               VARCHAR(255),
    business_type               VARCHAR(64),
    email                       VARCHAR(255) UNIQUE NOT NULL,
    phone                       VARCHAR(32),
    address_line1               VARCHAR(255),
    address_line2               VARCHAR(255),
    address_city                VARCHAR(128),
    address_state               VARCHAR(64),
    address_zip                 VARCHAR(16),
    address_country             VARCHAR(8) NOT NULL DEFAULT 'US',
    logo_url                    VARCHAR(512),
    brand_color_primary         VARCHAR(16),
    stripe_connect_account_id   VARCHAR(255) UNIQUE,
    stripe_connect_status       VARCHAR(32) NOT NULL DEFAULT 'not_started',
    bliss_fee_percentage        NUMERIC(5,4) NOT NULL DEFAULT 0.03,
    status                      VARCHAR(32) NOT NULL DEFAULT 'pending_verification',
    email_verified_at           TIMESTAMPTZ,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX merchants_slug_idx ON merchants(slug);
CREATE INDEX merchants_email_idx ON merchants(email);
CREATE INDEX merchants_status_idx ON merchants(status);
CREATE INDEX merchants_stripe_connect_account_idx ON merchants(stripe_connect_account_id);

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER merchants_set_updated_at
    BEFORE UPDATE ON merchants
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
