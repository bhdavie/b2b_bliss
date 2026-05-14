-- Collapse the after-retries action set from five values to two.
--
-- The old set (mark_defaulted, cancel_forfeit, cancel_refund,
-- convert_to_credit) re-implemented refund/credit logic that already
-- belongs to the Refund policy and Cancellation fee columns. Replace
-- with two delegating options:
--
--   treat_as_cancellation     — invoke the cancellation handler exactly
--                               as if the customer canceled at this moment;
--                               Refund policy + Cancellation fee govern
--                               the outcome.
--   balance_due_at_checkin    — keep the booking active, mark the plan
--                               BALANCE_DUE, customer settles the unpaid
--                               remainder at arrival. No refund, no fee.
--
-- The PaymentPlanStatus value also drops its "_at_arrival" suffix
-- (BALANCE_DUE_AT_ARRIVAL → BALANCE_DUE) to match the cleaner enum name.

-- 1. Drop the old CHECK so we can rewrite the column to the new value set.
ALTER TABLE merchant_plan_rules
    DROP CONSTRAINT mpr_after_retries_chk;

-- 2. Migrate existing after_retries_action rows.
UPDATE merchant_plan_rules
   SET after_retries_action = 'treat_as_cancellation'
 WHERE after_retries_action IN (
       'mark_defaulted', 'cancel_forfeit', 'cancel_refund', 'convert_to_credit');
UPDATE merchant_plan_rules
   SET after_retries_action = 'balance_due_at_checkin'
 WHERE after_retries_action = 'balance_due_at_arrival';

-- 3. Re-add the CHECK constraint with the two-value set, then change default.
ALTER TABLE merchant_plan_rules
    ADD CONSTRAINT mpr_after_retries_chk
        CHECK (after_retries_action IN (
            'treat_as_cancellation', 'balance_due_at_checkin'
        ));
ALTER TABLE merchant_plan_rules
    ALTER COLUMN after_retries_action SET DEFAULT 'treat_as_cancellation';

-- 4. Rename the plan-state wire value for the balance-due case.
UPDATE payment_plans
   SET status = 'balance_due'
 WHERE status = 'balance_due_at_arrival';

-- 5. Refresh the partial unique index so the renamed state still blocks
--    a second active plan on the same booking.
DROP INDEX payment_plans_one_active_per_booking_idx;
CREATE UNIQUE INDEX payment_plans_one_active_per_booking_idx
    ON payment_plans(booking_id)
    WHERE status IN (
        'active', 'completed',
        'payment_failed_in_retry', 'payment_failed_exhausted',
        'balance_due'
    );
