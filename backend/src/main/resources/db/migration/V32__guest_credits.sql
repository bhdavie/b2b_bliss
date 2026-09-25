-- Future-stay credit for cancelled Mews stays.
--
-- A guest who cancels a plan on the Mews rail gets no cash refund: what they
-- paid (under the property's refund policy, less any cancellation fee) becomes
-- a credit toward a future stay at the same property. Bliss is the record of
-- that credit. Mews has no stored-value object to hold it, so the hotel applies
-- it by hand when the guest books again, and marks it applied here.
--
-- One row per cancelled plan: the unique index makes issuing a credit
-- idempotent, so a retried cancel can never credit the guest twice.
CREATE TABLE guest_credits (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id         UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    customer_id         UUID NOT NULL REFERENCES customers(id),
    source_plan_id      UUID NOT NULL REFERENCES payment_plans(id),
    amount_cents        BIGINT NOT NULL CHECK (amount_cents >= 0),
    currency            VARCHAR(8) NOT NULL,
    status              VARCHAR(16) NOT NULL DEFAULT 'available'
                        CHECK (status IN ('available', 'applied', 'void')),
    applied_booking_id  UUID REFERENCES bookings(id),
    note                TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX guest_credits_source_plan_idx ON guest_credits (source_plan_id);
CREATE INDEX guest_credits_merchant_idx ON guest_credits (merchant_id, status);
CREATE INDEX guest_credits_customer_idx ON guest_credits (customer_id);

CREATE TRIGGER guest_credits_set_updated_at
    BEFORE UPDATE ON guest_credits
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
