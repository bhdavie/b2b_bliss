-- PMS-native payment rails (Mews), additive only.
--
-- Until now every plan charges through Stripe. We are adding a second rail so a
-- plan can instead charge a card vaulted inside a PMS (Mews) via the Connector
-- API. This migration only adds new nullable columns plus the rail selector; no
-- existing column is altered, and every existing plan defaults to 'stripe', so
-- Stripe behavior is unchanged.
--
-- Columns mirror the existing Stripe ones on purpose:
--   customers.stripe_customer_id        -> customers.mews_customer_id
--   customer_cards.stripe_payment_method_id -> customer_cards.mews_credit_card_id
--   payment_schedule.stripe_payment_intent_id -> payment_schedule.mews_payment_id
-- Mews ids are kept in their own columns rather than overloading the
-- stripe-named ones, so the Stripe write paths stay byte-for-byte the same.

-- Rail selector on the plan. Source of truth for charge routing.
ALTER TABLE payment_plans
    ADD COLUMN payment_rail VARCHAR(16) NOT NULL DEFAULT 'stripe';

ALTER TABLE payment_plans
    ADD CONSTRAINT payment_plans_rail_chk
        CHECK (payment_rail IN ('stripe', 'mews'));

-- Mews account (customer) id, one per Bliss customer, like stripe_customer_id.
ALTER TABLE customers
    ADD COLUMN mews_customer_id VARCHAR(255);

-- Mews CreditCardId of a vaulted card, like stripe_payment_method_id.
ALTER TABLE customer_cards
    ADD COLUMN mews_credit_card_id VARCHAR(255);

-- Mews PaymentId recorded per installment charged on the Mews rail.
ALTER TABLE payment_schedule
    ADD COLUMN mews_payment_id VARCHAR(255);
