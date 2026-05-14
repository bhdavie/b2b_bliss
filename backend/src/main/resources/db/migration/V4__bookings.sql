-- Phase 3: bookings. A specific dated service the merchant is selling.
-- Plan options are not stored here; they're derived at render time by
-- PlanEligibilityService from appointment_date vs today (see CLAUDE.md
-- "Plan eligibility").
--
-- customer_id is intentionally not yet a foreign key. The customers table
-- arrives in Phase 4 and a follow-up migration will add the FK then.
--
-- customer_email_hint extends the data-model.md schema: merchants want to
-- record who a booking is for at create time. It's purely a label for the
-- merchant and (later) a pre-fill on the hosted page. The real customer
-- record gets attached in Phase 4 when the plan is accepted.

CREATE TABLE bookings (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id                 UUID NOT NULL REFERENCES merchants(id),
    booking_token               VARCHAR(64) UNIQUE NOT NULL,
    service_name                VARCHAR(255) NOT NULL,
    service_description         TEXT,
    total_amount_cents          BIGINT NOT NULL CHECK (total_amount_cents > 0),
    appointment_date            DATE NOT NULL,
    cancellation_policy         TEXT,
    status                      VARCHAR(32) NOT NULL DEFAULT 'sent',
    customer_id                 UUID,
    customer_name_hint          VARCHAR(255),
    customer_email_hint         VARCHAR(255),
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX bookings_merchant_idx ON bookings(merchant_id);
CREATE INDEX bookings_booking_token_idx ON bookings(booking_token);
CREATE INDEX bookings_status_idx ON bookings(status);
CREATE INDEX bookings_appointment_date_idx ON bookings(appointment_date);

CREATE TRIGGER bookings_set_updated_at
    BEFORE UPDATE ON bookings
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
