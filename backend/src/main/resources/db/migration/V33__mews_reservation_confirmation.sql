-- When the Mews reservation behind a booking was confirmed.
--
-- Checkout confirms the hold straight after the first installment is charged,
-- but Mews can refuse that confirm transiently, and an unconfirmed (Optional)
-- hold is released by Mews at its release time while the guest has already
-- paid. The reconciliation pass therefore retries until Mews confirms, and
-- these columns are what it works from:
--   mews_confirmed_at      set once Mews has the reservation confirmed
--   mews_confirm_attempts  background attempts so far, for alerting
--   mews_confirm_error     the last failure; 'canceled in mews' stops retries,
--                          since a reservation cancelled in Mews cannot be
--                          confirmed and needs a person
ALTER TABLE bookings
    ADD COLUMN mews_confirmed_at     TIMESTAMPTZ,
    ADD COLUMN mews_confirm_attempts INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN mews_confirm_error    TEXT;
