-- Phase 14: plan discount. Merchants offer a flat percentage off bookings paid
-- via a Bliss plan to trade margin for confirmed bookings + better conversion.
--
-- discount_basis_points: 1000 == 10.00%. Stored in basis points to avoid
-- floating-point math anywhere in the money path (CLAUDE.md "All money values
-- stored as integer cents"). Allowed range 0-5000 (max 50%) is enforced in the
-- API resource; the DB only enforces the wider sanity bound.
--
-- bookings.original_total_cents preserves the pre-discount price when a plan
-- is accepted. NULL means no discount was applied (the displayed
-- total_amount_cents already equals the published booking price).

ALTER TABLE merchant_plan_rules
    ADD COLUMN discount_basis_points INTEGER NOT NULL DEFAULT 0
        CHECK (discount_basis_points >= 0 AND discount_basis_points <= 10000);

ALTER TABLE bookings
    ADD COLUMN original_total_cents BIGINT
        CHECK (original_total_cents IS NULL OR original_total_cents > 0);
