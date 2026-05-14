-- Phase 8: merchants configure their own plan-eligibility rules.
--
-- One row per merchant. Absent rows fall back to system defaults handled in
-- the application layer (MerchantPlanRules.DEFAULTS), so we deliberately do
-- not backfill — only merchants who customize get a row.
--
-- The defaults baked into the DB column DEFAULTs mirror the defaults in
-- code so a manual INSERT that omits columns lands on the same shape that
-- the application would have synthesized.

CREATE TABLE merchant_plan_rules (
    id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id                     UUID NOT NULL UNIQUE REFERENCES merchants(id),
    min_lead_time_weeks             SMALLINT NOT NULL DEFAULT 6
        CHECK (min_lead_time_weeks >= 0 AND min_lead_time_weeks <= 520),
    max_lead_time_weeks             SMALLINT
        CHECK (max_lead_time_weeks IS NULL OR (max_lead_time_weeks >= 1 AND max_lead_time_weeks <= 520)),
    allowed_frequencies             VARCHAR(16) NOT NULL DEFAULT 'both'
        CHECK (allowed_frequencies IN ('monthly', 'biweekly', 'both')),
    min_booking_amount_cents        BIGINT
        CHECK (min_booking_amount_cents IS NULL OR min_booking_amount_cents > 0),
    max_booking_amount_cents        BIGINT
        CHECK (max_booking_amount_cents IS NULL OR max_booking_amount_cents > 0),
    recommended_frequency           VARCHAR(16)
        CHECK (recommended_frequency IS NULL OR recommended_frequency IN ('monthly', 'biweekly')),
    created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT merchant_plan_rules_lead_range_chk
        CHECK (max_lead_time_weeks IS NULL OR max_lead_time_weeks >= min_lead_time_weeks),
    CONSTRAINT merchant_plan_rules_amount_range_chk
        CHECK (max_booking_amount_cents IS NULL
               OR min_booking_amount_cents IS NULL
               OR max_booking_amount_cents >= min_booking_amount_cents)
);

CREATE INDEX merchant_plan_rules_merchant_idx ON merchant_plan_rules(merchant_id);

CREATE TRIGGER merchant_plan_rules_set_updated_at
    BEFORE UPDATE ON merchant_plan_rules
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
