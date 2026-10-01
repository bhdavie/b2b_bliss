-- Configurable properties, phase 2: auto-sync with Mews and the Bliss fee
-- folio line.

-- Each Bliss rate as last synced from Mews, with the hotel's override. Which
-- rates are Bliss rates is still chosen on merchant_mews_connections
-- (bliss_monthly_rate_id / bliss_biweekly_rate_id); this table holds what Bliss
-- knows about each of them.
--
--   cancellation_terms   the rate group's active Mews cancellation policies
--                        (payments.CancellationTerms), [] for none
--   derived_booking_type what those terms mean: non_refundable when the whole
--                        stay is charged from booking, refundable otherwise
--   booking_type_override the hotel's choice; null follows Mews
CREATE TABLE merchant_bliss_rates (
    merchant_id           UUID        NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    mews_rate_id          VARCHAR(64) NOT NULL,
    frequency             VARCHAR(16) NOT NULL,
    rate_name             VARCHAR(255),
    rate_group_id         VARCHAR(64),
    active                BOOLEAN     NOT NULL DEFAULT TRUE,
    cancellation_terms    JSONB       NOT NULL DEFAULT '[]'::jsonb,
    derived_booking_type  VARCHAR(32) NOT NULL DEFAULT 'refundable',
    booking_type_override VARCHAR(32),
    synced_at             TIMESTAMPTZ,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (merchant_id, mews_rate_id),
    CONSTRAINT merchant_bliss_rates_frequency_chk CHECK (frequency IN ('monthly', 'biweekly')),
    CONSTRAINT merchant_bliss_rates_derived_chk
        CHECK (derived_booking_type IN ('refundable', 'non_refundable')),
    CONSTRAINT merchant_bliss_rates_override_chk
        CHECK (booking_type_override IS NULL OR booking_type_override IN ('refundable', 'non_refundable'))
);

CREATE TRIGGER merchant_bliss_rates_set_updated_at
    BEFORE UPDATE ON merchant_bliss_rates
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- The current Bliss rates, unsynced until the first sync fills them in.
INSERT INTO merchant_bliss_rates (merchant_id, mews_rate_id, frequency)
SELECT merchant_id, bliss_monthly_rate_id, 'monthly'
FROM merchant_mews_connections WHERE bliss_monthly_rate_id IS NOT NULL
ON CONFLICT DO NOTHING;
INSERT INTO merchant_bliss_rates (merchant_id, mews_rate_id, frequency)
SELECT merchant_id, bliss_biweekly_rate_id, 'biweekly'
FROM merchant_mews_connections WHERE bliss_biweekly_rate_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- One row per sync of a property's setup from Mews: when, what changed, and
-- any error. Feeds "Last synced" in Settings and the change emails.
CREATE TABLE mews_sync_runs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID        NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    started_at  TIMESTAMPTZ NOT NULL,
    finished_at TIMESTAMPTZ,
    changes     JSONB       NOT NULL DEFAULT '[]'::jsonb,
    error       TEXT
);
CREATE INDEX mews_sync_runs_merchant_idx ON mews_sync_runs (merchant_id, started_at DESC);

-- Everything Bliss writes to a Mews folio, once each. The idempotency key is
-- unique, so a retry can never post a second line; mews_id is filled once
-- Mews accepts it.
CREATE TABLE folio_postings (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id      UUID        NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    kind            VARCHAR(32) NOT NULL,
    idempotency_key VARCHAR(128) NOT NULL UNIQUE,
    amount_minor    BIGINT      NOT NULL,
    currency        VARCHAR(3)  NOT NULL,
    status          VARCHAR(16) NOT NULL DEFAULT 'pending',
    mews_id         VARCHAR(64),
    last_error      TEXT,
    attempts        INT         NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    posted_at       TIMESTAMPTZ,
    CONSTRAINT folio_postings_kind_chk CHECK (kind IN ('fee_line')),
    CONSTRAINT folio_postings_status_chk CHECK (status IN ('pending', 'posted'))
);
CREATE INDEX folio_postings_pending_idx ON folio_postings (status) WHERE status = 'pending';

-- Where the fee line posts in Mews, and its tax. Mews only takes orders on an
-- additional service, so the line needs one; Bliss picks a service named like
-- "Bliss" when it finds one. With no tax code the line is untaxed; the tax
-- treatment is a setting the hotel can change later.
ALTER TABLE property_bliss_settings
    ADD COLUMN fee_service_id             VARCHAR(64),
    ADD COLUMN fee_tax_code               VARCHAR(64),
    ADD COLUMN fee_accounting_category_id VARCHAR(64);
