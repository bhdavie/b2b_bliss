-- Currency, time zone and locale per property, snapshotted onto each booking.
--
-- Until now every amount was implicitly USD (Stripe charges hardcoded "usd",
-- emails printed "$") and every "today" was the UTC date. Bliss now runs for
-- properties in any currency and zone, so each property carries its own:
--
--   currency   ISO 4217 code. Never defaulted in code: it comes from the PMS
--              (Mews configuration/get, Cloudbeds) or the Stripe account, and
--              a property without one cannot take bookings.
--   time_zone  IANA zone. Due dates are calendar days in this zone, so an
--              installment is charged when that day starts at the property.
--   locale     BCP 47 tag (Mews DefaultLanguageCode) used to format amounts and
--              dates in guest-facing copy.
--
-- A booking snapshots all three when it is created. Its price, and every plan
-- and schedule row built on it, are minor units of the booking's currency, so
-- a property changing currency later never reinterprets an existing plan.

ALTER TABLE merchants
    ADD COLUMN currency  VARCHAR(3),
    ADD COLUMN time_zone VARCHAR(64),
    ADD COLUMN locale    VARCHAR(35);

ALTER TABLE merchant_mews_connections
    ADD COLUMN locale VARCHAR(35);

ALTER TABLE bookings
    ADD COLUMN currency  VARCHAR(3),
    ADD COLUMN time_zone VARCHAR(64),
    ADD COLUMN locale    VARCHAR(35);

ALTER TABLE merchants
    ADD CONSTRAINT merchants_currency_iso_chk CHECK (currency ~ '^[A-Z]{3}$');
ALTER TABLE bookings
    ADD CONSTRAINT bookings_currency_iso_chk CHECK (currency ~ '^[A-Z]{3}$');

-- Backfill. These record what existing rows already meant; they are not
-- defaults for new rows.
--
-- PMS properties: what their connection already says.
UPDATE merchants m
SET currency  = UPPER(NULLIF(mc.currency, '')),
    time_zone = NULLIF(mc.time_zone, '')
FROM merchant_mews_connections mc
WHERE mc.merchant_id = m.id AND m.pms_type = 'mews';

UPDATE merchants m
SET currency = UPPER(NULLIF(cc.currency, ''))
FROM merchant_cloudbeds_connections cc
WHERE cc.merchant_id = m.id AND m.pms_type = 'cloudbeds';

-- Stripe and no-PMS properties: every amount they entered was charged in USD
-- and every due date was read as a UTC day. Recording exactly that keeps their
-- existing plans charging the same amounts on the same days.
UPDATE merchants
SET currency  = 'USD',
    time_zone = 'UTC',
    locale    = 'en-US'
WHERE pms_type IN ('stripe', 'none') AND currency IS NULL;

-- Existing bookings take their property's values. A Mews property with no
-- connection currency leaves its bookings NULL: those could never be charged.
-- A NULL booking time zone is read as UTC by the charge pass, which is how
-- every booking was read before this migration.
UPDATE bookings b
SET currency  = m.currency,
    time_zone = m.time_zone,
    locale    = m.locale
FROM merchants m
WHERE m.id = b.merchant_id;
