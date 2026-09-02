-- Per-property, versioned Bliss processing fee.
--
-- The rate applied to a plan was a hardcoded constant (PlanCreationService
-- BLISS_FEE_RATE = 0.05), so every property paid the same and the rate could
-- only move by deploy. This table makes it per-property and time-ordered: the
-- rate in force for a plan is the row with the greatest effective_from that is
-- not in the future at the moment the plan is created.
--
-- Nothing here touches an existing plan. payment_plans.processing_fee_cents
-- already freezes the resolved fee at creation (see V13) and the charge path
-- reads payment_schedule.amount_cents, so changing a rate today cannot reprice
-- a plan that already exists. This table only feeds the resolution for NEW
-- plans; it is deliberately not joined at read time anywhere.
--
-- Rows are append-only by convention: a rate change is a new row with a later
-- effective_from, never an UPDATE, so the history stays auditable and a plan
-- created last month can still be explained.

CREATE TABLE merchant_fee_rates (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id          UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    -- numeric(6,5) holds 0.05000 exactly. The ceiling is a guard against a
    -- fat-fingered 5 meaning 500%, not a business rule.
    rate                 NUMERIC(6,5) NOT NULL CHECK (rate >= 0 AND rate <= 0.25),
    effective_from       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    note                 VARCHAR(255),
    created_by_admin_id  UUID REFERENCES admin_users(id),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The resolution query is "greatest effective_from <= :at for this merchant",
-- which this index serves directly as an ordered range scan.
CREATE INDEX merchant_fee_rates_merchant_effective_idx
    ON merchant_fee_rates (merchant_id, effective_from DESC);

-- Backfill at 0.05, not at the 0.03 sitting in merchants.bliss_fee_percentage.
-- 0.05 is what the code actually applied to every plan ever created, so it is
-- the only value that makes the history true. effective_from is the merchant's
-- own created_at so the row covers every plan that property has.
INSERT INTO merchant_fee_rates (merchant_id, rate, effective_from, note)
SELECT id, 0.05000, created_at, 'backfill: legacy flat rate'
FROM merchants;

-- NOT DROPPING merchants.bliss_fee_percentage.
--
-- It was described as having no readers. It has four, and they are live:
--   MerchantDao.findFeePercentage          the accessor
--   PlanCreationService (destination)      plan creation
--   JdbiStripeInstallmentCharger           the recurring charge path
--   PlanPortalService (x2)                 portal reads
--
-- It is also not the same fee as this table. bliss_fee_percentage sizes
-- application_fee_amount on Stripe Connect destination charges: it is what Bliss
-- keeps out of a charge before the remainder transfers to the property's
-- connected account. This table is the guest-facing processing fee added on top
-- of the booking total. Two different numbers with two different payers, which
-- is why they hold two different values (0.03 and 0.05) without either being
-- wrong.
--
-- Dropping the column would not fail the build, because the reference is inside
-- a JDBI @SqlQuery string. It would fail at runtime, on the charge path, the
-- next time an installment came due against a Connect property.
