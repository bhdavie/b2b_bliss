-- The custom payment-due deadline (payment_due_custom_months) changed semantics
-- from months-before-check-in to days-before-check-in. The column name is kept
-- for wire/storage compatibility; only the meaning and valid range change.
-- Widen the CHECK constraint from 1-24 (months) to 1-365 (days). Column stays
-- SMALLINT, which comfortably holds 365.

ALTER TABLE merchant_plan_rules
    DROP CONSTRAINT mpr_payment_due_custom_chk;

ALTER TABLE merchant_plan_rules
    ADD CONSTRAINT mpr_payment_due_custom_chk
        CHECK (
            payment_due_policy != 'custom_months'
            OR (payment_due_custom_months BETWEEN 1 AND 365)
        );
