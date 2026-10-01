-- Per-property Bliss settings (configurable-property spec, phase 1).
--
-- Every setting has a default, so a property works with no row and no
-- configuration. A row exists once Bliss is switched on (or, for properties
-- that predate this, from the backfill below); its values are the defaults
-- until the hotel changes one. Settings that live elsewhere (plan rules, the
-- fee rate, currency and zone) stay where they are; the settings API
-- assembles them into one view.
--
--   payout_mode            pay_as_you_go: installments charged through the
--                          property's own processor (today). hold: Stripe holds
--                          the guest's money and Bliss releases it to the
--                          property (behind the holdMode feature flag).
--   release_policy         hold mode only: when held money is released.
--                          cancellation_deadline (default), check_in, on_collection.
--   chargeback_buffer_days hold mode only: days after a payment settles before
--                          an on_collection release (spec D4, proposed 3).
--   bliss_enabled_at       when the property switched Bliss on; null until then.
CREATE TABLE property_bliss_settings (
    merchant_id            UUID PRIMARY KEY REFERENCES merchants(id) ON DELETE CASCADE,
    payout_mode            VARCHAR(32) NOT NULL DEFAULT 'pay_as_you_go',
    release_policy         VARCHAR(32) NOT NULL DEFAULT 'cancellation_deadline',
    chargeback_buffer_days INT         NOT NULL DEFAULT 3,
    bliss_enabled_at       TIMESTAMPTZ,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT property_bliss_settings_payout_mode_chk
        CHECK (payout_mode IN ('pay_as_you_go', 'hold')),
    CONSTRAINT property_bliss_settings_release_policy_chk
        CHECK (release_policy IN ('cancellation_deadline', 'check_in', 'on_collection')),
    CONSTRAINT property_bliss_settings_buffer_chk
        CHECK (chargeback_buffer_days BETWEEN 0 AND 30)
);

CREATE TRIGGER property_bliss_settings_set_updated_at
    BEFORE UPDATE ON property_bliss_settings
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Existing properties: a row of defaults (today's behaviour). Those already
-- set up count as switched on, from when they were created.
INSERT INTO property_bliss_settings (merchant_id, bliss_enabled_at)
SELECT id, CASE WHEN onboarding_state = 'active' THEN created_at END
FROM merchants
ON CONFLICT (merchant_id) DO NOTHING;

-- Booking snapshots, filled from later phases on. A booking keeps the payout
-- mode and cancellation terms it was made under, as it keeps its currency.
-- cancellation_terms is the structured snapshot synced from Mews; the older
-- cancellation_policy column is the free text a merchant types on a dashboard
-- booking, and stays as it is.
ALTER TABLE bookings
    ADD COLUMN payout_mode             VARCHAR(32),
    ADD COLUMN booking_type            VARCHAR(32),
    ADD COLUMN cancellation_terms      JSONB,
    ADD COLUMN free_cancellation_until TIMESTAMPTZ;

ALTER TABLE bookings
    ADD CONSTRAINT bookings_payout_mode_chk
        CHECK (payout_mode IS NULL OR payout_mode IN ('pay_as_you_go', 'hold')),
    ADD CONSTRAINT bookings_booking_type_chk
        CHECK (booking_type IS NULL OR booking_type IN ('refundable', 'non_refundable'));

-- Every booking so far was pay as you go.
UPDATE bookings SET payout_mode = 'pay_as_you_go' WHERE payout_mode IS NULL;
