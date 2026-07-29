-- Property-level blackout dates: specific calendar dates on which the merchant
-- does not offer a Bliss plan. Evaluated against the guest's STAY dates, not
-- their booking date.
--
-- Stored as a JSONB array of ISO yyyy-MM-dd strings, e.g. ["2026-12-24","2026-12-25"].
-- A single column rather than a child table: every other policy on this table
-- is a scalar column and the DAO is one wide upsert, so a child table would be
-- the only multi-row policy in the schema and would need its own read path.
--
-- NULL means unset, consistent with every other nullable field here. Existing
-- rows are untouched: no default, no backfill. The application layer treats
-- NULL and [] identically (no blackout dates configured).
--
-- No CHECK on the element format. Postgres cannot validate ISO dates inside a
-- JSONB array without a function, and the parse already happens twice in the
-- application: PlanRulesResource on write and MerchantPlanRulesRowMapper on
-- read. The type check below is the part the database can usefully enforce.

ALTER TABLE merchant_plan_rules
    ADD COLUMN blackout_dates JSONB
        CONSTRAINT merchant_plan_rules_blackout_dates_array_chk
        CHECK (blackout_dates IS NULL OR jsonb_typeof(blackout_dates) = 'array');
