-- Phase 10 + 11: merchant policy layer (cancellation, refunds, dunning) and
-- the payment plan state machine.
--
-- Six new policy areas on merchant_plan_rules:
--   1. Refund policy on cancellation (full | none | first_installment_only |
--      sliding_scale | credit_only). Sliding scale picks a progress threshold.
--   2. Cancellation fee (fixed or percent, optionally only above a threshold).
--   3. Payment due date policy: when do all installments need to clear by?
--   4. Failed-payment retry policy (attempts + spacing days).
--   5. Late fee on failed payment (fixed or percent, per-failure or once-per-plan).
--   6. After-retries action: what happens when the retry policy is exhausted.
--
-- Plus customers.credit_balance_cents for the "credit only" refund policy
-- (the balance is tracked; redemption flow is not yet built).
--
-- payment_plans.status keeps the same column but the application enum gains
-- three new values: payment_failed_in_retry, payment_failed_exhausted,
-- balance_due_at_arrival. The partial unique index is updated to include
-- those new states so a struggling plan still blocks a second plan on the
-- same booking.

ALTER TABLE merchant_plan_rules
    ADD COLUMN refund_policy VARCHAR(32) NOT NULL DEFAULT 'full',
    ADD COLUMN refund_sliding_threshold_percent SMALLINT,
    ADD COLUMN cancellation_fee_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN cancellation_fee_type VARCHAR(16),
    ADD COLUMN cancellation_fee_value BIGINT,
    ADD COLUMN cancellation_fee_threshold_percent SMALLINT,
    ADD COLUMN payment_due_policy VARCHAR(32) NOT NULL DEFAULT 'at_appointment',
    ADD COLUMN payment_due_custom_months SMALLINT,
    ADD COLUMN retry_attempts SMALLINT NOT NULL DEFAULT 3,
    ADD COLUMN retry_spacing_days SMALLINT NOT NULL DEFAULT 3,
    ADD COLUMN late_fee_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN late_fee_type VARCHAR(16),
    ADD COLUMN late_fee_value BIGINT,
    ADD COLUMN late_fee_scope VARCHAR(32),
    ADD COLUMN after_retries_action VARCHAR(32) NOT NULL DEFAULT 'mark_defaulted';

ALTER TABLE merchant_plan_rules
    ADD CONSTRAINT mpr_refund_policy_chk
        CHECK (refund_policy IN (
            'full', 'none', 'first_installment_only', 'sliding_scale', 'credit_only'
        )),
    ADD CONSTRAINT mpr_refund_threshold_chk
        CHECK (
            refund_policy != 'sliding_scale'
            OR (refund_sliding_threshold_percent BETWEEN 1 AND 99)
        ),
    ADD CONSTRAINT mpr_cancellation_fee_type_chk
        CHECK (cancellation_fee_type IS NULL
               OR cancellation_fee_type IN ('fixed', 'percentage')),
    ADD CONSTRAINT mpr_cancellation_fee_value_chk
        CHECK (
            cancellation_fee_enabled = FALSE
            OR (cancellation_fee_type = 'percentage' AND cancellation_fee_value BETWEEN 1 AND 100)
            OR (cancellation_fee_type = 'fixed' AND cancellation_fee_value > 0)
        ),
    ADD CONSTRAINT mpr_cancellation_fee_threshold_chk
        CHECK (cancellation_fee_threshold_percent IS NULL
               OR cancellation_fee_threshold_percent BETWEEN 0 AND 100),
    ADD CONSTRAINT mpr_payment_due_policy_chk
        CHECK (payment_due_policy IN (
            'at_appointment', 'one_week_before', 'one_month_before', 'custom_months'
        )),
    ADD CONSTRAINT mpr_payment_due_custom_chk
        CHECK (
            payment_due_policy != 'custom_months'
            OR (payment_due_custom_months BETWEEN 1 AND 24)
        ),
    ADD CONSTRAINT mpr_retry_attempts_chk
        CHECK (retry_attempts BETWEEN 1 AND 5),
    ADD CONSTRAINT mpr_retry_spacing_chk
        CHECK (retry_spacing_days IN (1, 3, 7)),
    ADD CONSTRAINT mpr_late_fee_type_chk
        CHECK (late_fee_type IS NULL OR late_fee_type IN ('fixed', 'percentage')),
    ADD CONSTRAINT mpr_late_fee_scope_chk
        CHECK (late_fee_scope IS NULL OR late_fee_scope IN ('per_failure', 'once_per_plan')),
    ADD CONSTRAINT mpr_late_fee_value_chk
        CHECK (
            late_fee_enabled = FALSE
            OR (late_fee_type = 'percentage' AND late_fee_value BETWEEN 1 AND 100)
            OR (late_fee_type = 'fixed' AND late_fee_value > 0)
        ),
    ADD CONSTRAINT mpr_after_retries_chk
        CHECK (after_retries_action IN (
            'cancel_forfeit', 'cancel_refund', 'mark_defaulted',
            'convert_to_credit', 'balance_due_at_arrival'
        ));

ALTER TABLE customers
    ADD COLUMN credit_balance_cents BIGINT NOT NULL DEFAULT 0
        CHECK (credit_balance_cents >= 0);

-- The "one active plan per booking" guard needs to include the three new
-- active states so a plan that hit retry trouble still blocks a second
-- accept of the same booking.
DROP INDEX payment_plans_one_active_per_booking_idx;
CREATE UNIQUE INDEX payment_plans_one_active_per_booking_idx
    ON payment_plans(booking_id)
    WHERE status IN (
        'active', 'completed',
        'payment_failed_in_retry', 'payment_failed_exhausted',
        'balance_due_at_arrival'
    );
