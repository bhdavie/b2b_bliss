-- Mews guest checkout seam.
--
-- Additive only. A Mews-rail plan is created before the guest enters a card
-- (the card is captured out-of-band through the Mews Payments Checkout embed),
-- so it needs somewhere to hold the pending payment-method request id between
-- the card-request and card-confirm steps.
--
-- payment_rail already exists (V16, default 'stripe'); every existing plan row
-- already carries 'stripe', so no backfill is required. New Mews plans set
-- payment_rail = 'mews' at insert time in PlanCreationService.

ALTER TABLE payment_plans
    ADD COLUMN pending_mews_request_id VARCHAR(255);
