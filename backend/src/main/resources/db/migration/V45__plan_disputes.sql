-- Card disputes (chargebacks) on Bliss charges, from charge.dispute.* events
-- on the platform webhook endpoint. Destination charges and on_behalf_of
-- charges are both made on the platform, so their disputes are raised there,
-- not on the connected accounts. Attached to the plan and payment the disputed
-- charge paid when Bliss can match it; kept unmatched otherwise, so a dispute
-- is never dropped.
CREATE TABLE plan_disputes (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stripe_dispute_id        VARCHAR(255) NOT NULL UNIQUE,
    stripe_charge_id         VARCHAR(255),
    stripe_payment_intent_id VARCHAR(255),
    payment_plan_id          UUID REFERENCES payment_plans(id) ON DELETE SET NULL,
    payment_schedule_id      UUID REFERENCES payment_schedule(id) ON DELETE SET NULL,
    merchant_id              UUID REFERENCES merchants(id) ON DELETE SET NULL,
    amount_minor             BIGINT       NOT NULL,
    currency                 VARCHAR(3)   NOT NULL,
    reason                   VARCHAR(64),
    -- Stripe's status: warning_needs_response, warning_under_review,
    -- warning_closed, needs_response, under_review, won, lost.
    status                   VARCHAR(32)  NOT NULL,
    evidence_due_by          TIMESTAMPTZ,
    livemode                 BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    closed_at                TIMESTAMPTZ,
    -- A dispute pauses its plan's automatic payments until it closes won (or
    -- as a warning). After a loss they stay paused until an admin resumes them.
    charges_resumed_at       TIMESTAMPTZ,
    charges_resumed_by       VARCHAR(255)
);
CREATE INDEX plan_disputes_plan_idx ON plan_disputes (payment_plan_id);
CREATE INDEX plan_disputes_merchant_idx ON plan_disputes (merchant_id);
