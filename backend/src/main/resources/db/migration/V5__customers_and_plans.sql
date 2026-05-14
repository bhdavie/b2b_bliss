-- Phase 4: consumer-side data model.
--
-- A Customer is the end consumer. They get auto-created on first plan setup,
-- keyed by email. Their Stripe Customer record holds the card vault.
--
-- A CustomerCard is a saved Stripe PaymentMethod attached to that Customer.
-- We never store PAN; the pm_xxx id is the only reference.
--
-- A PaymentPlan is the committed plan against a specific Booking, with a
-- PaymentSchedule of dated installments. The first row in the schedule has
-- due_date = today and is fired immediately on plan creation. Remaining rows
-- are fired by the scheduled-charge engine in Phase 5.
--
-- We also retro-add the FK from bookings.customer_id to customers(id) — the
-- column existed in V4 but the target table did not yet.

CREATE TABLE customers (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email                   VARCHAR(255) UNIQUE NOT NULL,
    phone                   VARCHAR(32),
    first_name              VARCHAR(128),
    last_name               VARCHAR(128),
    stripe_customer_id      VARCHAR(255) UNIQUE,
    last_login_at           TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX customers_email_idx ON customers(email);

CREATE TRIGGER customers_set_updated_at
    BEFORE UPDATE ON customers
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE customer_cards (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id                 UUID NOT NULL REFERENCES customers(id),
    stripe_payment_method_id    VARCHAR(255) UNIQUE NOT NULL,
    last_four                   VARCHAR(4) NOT NULL,
    exp_month                   SMALLINT NOT NULL,
    exp_year                    SMALLINT NOT NULL,
    brand                       VARCHAR(32) NOT NULL,
    is_default                  BOOLEAN NOT NULL DEFAULT FALSE,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at                  TIMESTAMPTZ
);

CREATE INDEX customer_cards_customer_idx ON customer_cards(customer_id);

CREATE TABLE payment_plans (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id              UUID NOT NULL REFERENCES bookings(id),
    customer_id             UUID NOT NULL REFERENCES customers(id),
    customer_card_id        UUID NOT NULL REFERENCES customer_cards(id),
    total_amount_cents      BIGINT NOT NULL CHECK (total_amount_cents > 0),
    num_payments            SMALLINT NOT NULL CHECK (num_payments >= 2),
    frequency               VARCHAR(32) NOT NULL,
    start_date              DATE NOT NULL,
    end_date                DATE NOT NULL,
    status                  VARCHAR(32) NOT NULL DEFAULT 'active',
    canceled_at             TIMESTAMPTZ,
    canceled_reason         TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX payment_plans_booking_idx ON payment_plans(booking_id);
CREATE INDEX payment_plans_customer_idx ON payment_plans(customer_id);
CREATE INDEX payment_plans_status_idx ON payment_plans(status);
-- One active plan per booking. A booking can be re-attempted only if its
-- previous plan was canceled or defaulted.
CREATE UNIQUE INDEX payment_plans_one_active_per_booking_idx
    ON payment_plans(booking_id)
    WHERE status IN ('active', 'completed');

CREATE TRIGGER payment_plans_set_updated_at
    BEFORE UPDATE ON payment_plans
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE payment_schedule (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_plan_id             UUID NOT NULL REFERENCES payment_plans(id),
    sequence                    SMALLINT NOT NULL,
    due_date                    DATE NOT NULL,
    amount_cents                BIGINT NOT NULL CHECK (amount_cents > 0),
    status                      VARCHAR(32) NOT NULL DEFAULT 'scheduled',
    stripe_payment_intent_id    VARCHAR(255),
    attempted_at                TIMESTAMPTZ,
    paid_at                     TIMESTAMPTZ,
    retry_count                 SMALLINT NOT NULL DEFAULT 0,
    last_error                  TEXT,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (payment_plan_id, sequence)
);

CREATE INDEX payment_schedule_plan_idx ON payment_schedule(payment_plan_id);
CREATE INDEX payment_schedule_due_date_idx ON payment_schedule(due_date);
CREATE INDEX payment_schedule_status_idx ON payment_schedule(status);

CREATE TRIGGER payment_schedule_set_updated_at
    BEFORE UPDATE ON payment_schedule
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE bookings
    ADD CONSTRAINT bookings_customer_id_fkey
    FOREIGN KEY (customer_id) REFERENCES customers(id);
