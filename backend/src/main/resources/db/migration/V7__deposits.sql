-- Phase 9: deposit configuration.
--
-- Merchants can now collect a deposit at booking signup (percentage or fixed
-- cents), with an optional cap. The deposit fires immediately as its own
-- charge; remaining balance is divided across installments at the customer's
-- chosen cadence.
--
-- Schema additions:
--
-- merchant_plan_rules
--   deposit_required           bool — top-level toggle
--   deposit_type               'percentage' | 'fixed' — null when not required
--   deposit_value              percent 1-100 OR cents > 0, interpretation
--                              depends on deposit_type. Polymorphic to keep
--                              the schema tight; application layer reads
--                              both columns together.
--   deposit_max_cents          optional cap so a fixed deposit doesn't blow
--                              past a small booking total
--
-- payment_plans
--   deposit_amount_cents       resolved deposit at acceptance time. Stored
--                              so historical plans don't drift when the
--                              merchant changes rules later.
--
-- payment_schedule
--   kind                       'deposit' | 'installment'. The deposit row is
--                              sequence 1, fires today. Installments are
--                              sequence 2..N, fire on the chosen cadence.
--
-- We also relax payment_plans.num_payments from >= 2 to >= 1, because a
-- deposit + 1 installment is a valid plan (six-week booking, monthly
-- cadence, $200 deposit on $800).

ALTER TABLE merchant_plan_rules
    ADD COLUMN deposit_required BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN deposit_type     VARCHAR(16),
    ADD COLUMN deposit_value    BIGINT,
    ADD COLUMN deposit_max_cents BIGINT;

ALTER TABLE merchant_plan_rules
    ADD CONSTRAINT merchant_plan_rules_deposit_type_chk
        CHECK (deposit_type IS NULL OR deposit_type IN ('percentage', 'fixed')),
    ADD CONSTRAINT merchant_plan_rules_deposit_value_chk
        CHECK (
            deposit_required = FALSE
            OR (deposit_type = 'percentage' AND deposit_value BETWEEN 1 AND 99)
            OR (deposit_type = 'fixed' AND deposit_value > 0)
        ),
    ADD CONSTRAINT merchant_plan_rules_deposit_max_chk
        CHECK (deposit_max_cents IS NULL OR deposit_max_cents > 0);

ALTER TABLE payment_plans
    ADD COLUMN deposit_amount_cents BIGINT NOT NULL DEFAULT 0
        CHECK (deposit_amount_cents >= 0);

-- Relax num_payments to allow deposit + 1 installment plans.
ALTER TABLE payment_plans
    DROP CONSTRAINT payment_plans_num_payments_check;
ALTER TABLE payment_plans
    ADD CONSTRAINT payment_plans_num_payments_check
        CHECK (num_payments >= 1);

ALTER TABLE payment_schedule
    ADD COLUMN kind VARCHAR(16) NOT NULL DEFAULT 'installment'
        CHECK (kind IN ('deposit', 'installment'));

CREATE INDEX payment_schedule_kind_idx ON payment_schedule(kind);
