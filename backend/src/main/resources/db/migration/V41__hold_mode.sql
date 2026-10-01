-- Hold mode (configurable-property spec, sections 2.2 and 2.3; phase 5 there).
-- Everything here is inert until a property is switched to hold mode, which
-- needs the holdMode feature flag (off until D3 is answered).

-- What has been, or will be, transferred to the property from the platform
-- balance. One row per paid payment (step "payment:{schedule id}") plus one
-- "cancellation" row when a cancellation settles the property's share. The
-- unique (booking, step) makes a release happen once.
CREATE TABLE payout_releases (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id         UUID        NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    payment_plan_id    UUID        NOT NULL REFERENCES payment_plans(id) ON DELETE CASCADE,
    step               VARCHAR(80) NOT NULL,
    release_at         TIMESTAMPTZ NOT NULL,
    -- Transferred to the property, minor units of the booking's currency,
    -- excluding the Bliss fee.
    amount_minor       BIGINT      NOT NULL CHECK (amount_minor >= 0),
    -- The Bliss fee kept back from this payment.
    fee_minor          BIGINT      NOT NULL DEFAULT 0 CHECK (fee_minor >= 0),
    -- What a cancellation pulled back from the property by transfer reversal.
    reversed_minor     BIGINT      NOT NULL DEFAULT 0 CHECK (reversed_minor >= 0),
    currency           VARCHAR(3)  NOT NULL,
    status             VARCHAR(16) NOT NULL DEFAULT 'scheduled',
    stripe_transfer_id VARCHAR(255),
    last_error         TEXT,
    attempts           INT         NOT NULL DEFAULT 0,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    released_at        TIMESTAMPTZ,
    CONSTRAINT payout_releases_step_uniq UNIQUE (booking_id, step),
    CONSTRAINT payout_releases_status_chk
        CHECK (status IN ('scheduled', 'released', 'reversed', 'canceled'))
);
CREATE INDEX payout_releases_due_idx ON payout_releases (release_at) WHERE status = 'scheduled';

-- Stripe payouts from a property's connected account to its bank, as Stripe
-- reports them (payout.* webhooks on the connected account).
CREATE TABLE payouts (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id      UUID        NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    stripe_payout_id VARCHAR(255) NOT NULL UNIQUE,
    amount_minor     BIGINT      NOT NULL,
    currency         VARCHAR(3)  NOT NULL,
    status           VARCHAR(32) NOT NULL,
    arrival_date     DATE,
    failure_message  TEXT,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX payouts_merchant_idx ON payouts (merchant_id, arrival_date DESC);

-- Ledger-only payments in the Mews folio for released money (payments/addExternal):
-- the stay share and, matching it, the Bliss fee share, so the folio closes (D15).
ALTER TABLE folio_postings DROP CONSTRAINT folio_postings_kind_chk;
ALTER TABLE folio_postings ADD CONSTRAINT folio_postings_kind_chk
    CHECK (kind IN ('fee_line', 'ledger_payment', 'ledger_fee'));

-- The Mews external payment type ledger payments post as. One of the
-- property's enabled types; agreed with the property's accounting (D16), so
-- null until chosen, and ledger payments wait until then.
ALTER TABLE property_bliss_settings
    ADD COLUMN ledger_payment_type VARCHAR(64);

-- A guest booked a Bliss rate at a hold-mode property, but the card isn't in
-- Stripe yet (D1: forwarding the card Mews holds isn't available).
ALTER TABLE mews_flags DROP CONSTRAINT mews_flags_kind_check;
ALTER TABLE mews_flags ADD CONSTRAINT mews_flags_kind_check
    CHECK (kind IN ('dates_changed', 'canceled_in_mews', 'no_upfront_charge',
                    'not_eligible', 'link_failed', 'hold_card_needed'));
