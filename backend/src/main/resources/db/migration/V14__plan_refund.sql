-- Manager refund override for the booking detail page. A refund here is a
-- manual manager action that deliberately supersedes the refund/cancellation
-- policy. Execution is simulated (no Stripe money movement); it is recorded as
-- state on the plan so the merchant detail page and the guest portal both read
-- it from the same record.
ALTER TABLE payment_plans
    ADD COLUMN refunded_at         TIMESTAMPTZ,
    ADD COLUMN refund_amount_cents BIGINT;
