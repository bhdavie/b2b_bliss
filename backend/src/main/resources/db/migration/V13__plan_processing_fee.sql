-- Bliss fee migration: flat $20 processing fee -> 5% of plan total.
--
-- The fee used to live only as a global constant (PROCESSING_FEE_CENTS = 2000),
-- re-added at display time and folded onto the first charge at creation. Moving
-- to 5% means historical plans must keep the fee they were actually created and
-- charged under, so we persist the resolved fee per plan.
--
-- Existing rows backfill to the legacy 2000 ($20) via the column DEFAULT, so old
-- plans stay frozen and continue to reconcile against their stored schedule.
-- New plans store 5% of total_amount_cents, set explicitly by PlanCreationService.
ALTER TABLE payment_plans
    ADD COLUMN processing_fee_cents BIGINT NOT NULL DEFAULT 2000
        CHECK (processing_fee_cents >= 0);

-- Drop the default so new inserts must supply the resolved fee explicitly; there
-- is no silent $20 fallback for plans created after the migration.
ALTER TABLE payment_plans
    ALTER COLUMN processing_fee_cents DROP DEFAULT;
