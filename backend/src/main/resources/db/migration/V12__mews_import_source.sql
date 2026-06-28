-- Mews import source (demo).
--
-- POST /api/v1/mews/sync pulls reservations from the Mews Connector API and,
-- for the eligible ones, mints a Bliss booking + payment plan. Those bookings
-- need a distinct provenance so they're not mistaken for dashboard-created or
-- customer-checkout bookings, hence a third booking_source value.
--
-- The booking_token of an imported booking is the Mews reservation id, which
-- gives us natural idempotency: a re-run skips reservations already imported.

ALTER TABLE bookings
    DROP CONSTRAINT bookings_source_chk;

ALTER TABLE bookings
    ADD CONSTRAINT bookings_source_chk
        CHECK (booking_source IN ('merchant_initiated', 'customer_initiated', 'mews_import'));
