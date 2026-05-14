-- Phase 13: customer-initiated bookings.
--
-- The existing /pay/{slug}/{token} flow assumes the merchant pre-created a
-- booking in their dashboard. This phase adds a parallel flow where the
-- customer lands at /checkout/{slug}?total=...&checkin=... directly from
-- the merchant's own checkout page, with the cart details in the URL.
-- Bookings created that way are flagged with source = 'customer_initiated'
-- so the merchant can spot them in their dashboard and mirror them into
-- their own back-office system.
--
-- Schema additions on bookings:
--   booking_source         enum-as-text. Existing rows backfilled to
--                          'merchant_initiated' (the only source that
--                          existed before today).
--   checkout_date          optional end-of-stay date for multi-day
--                          bookings (hotels, retreats). NULL for
--                          single-appointment bookings.
--   customer_phone_hint    parity with the existing email/name hints.
--                          Customers may supply a phone in the checkout
--                          URL; we surface it to the merchant before the
--                          real customer record is created.

ALTER TABLE bookings
    ADD COLUMN booking_source VARCHAR(32) NOT NULL DEFAULT 'merchant_initiated',
    ADD COLUMN checkout_date DATE,
    ADD COLUMN customer_phone_hint VARCHAR(32);

ALTER TABLE bookings
    ADD CONSTRAINT bookings_source_chk
        CHECK (booking_source IN ('merchant_initiated', 'customer_initiated'));

CREATE INDEX bookings_source_idx ON bookings(booking_source);
