# Data model

PostgreSQL schema for v1. All tables use UUID primary keys. Currency is stored as integer cents in BIGINT columns. Timestamps are TIMESTAMP WITH TIME ZONE in UTC.

Migrations are managed via Flyway in `backend/src/main/resources/db/migration/`.

## Tables

### merchants

The business account holder.

```
id                          UUID PRIMARY KEY
slug                        VARCHAR(64) UNIQUE NOT NULL   -- URL-safe identifier
business_name               VARCHAR(255) NOT NULL
business_type               VARCHAR(64) NOT NULL          -- enum: photography, hotel, retreat, salon, medspa, other
email                       VARCHAR(255) UNIQUE NOT NULL
password_hash               VARCHAR(255) NOT NULL
phone                       VARCHAR(32)
address_line1               VARCHAR(255)
address_line2               VARCHAR(255)
address_city                VARCHAR(128)
address_state               VARCHAR(64)
address_zip                 VARCHAR(16)
address_country             VARCHAR(8) DEFAULT 'US'
logo_url                    VARCHAR(512)
brand_color_primary         VARCHAR(16)                   -- hex, optional merchant brand override
stripe_connect_account_id   VARCHAR(255) UNIQUE           -- acct_xxx, populated after Connect onboarding
stripe_connect_status       VARCHAR(32)                   -- enum: not_started, in_progress, charges_enabled, restricted
bliss_fee_percentage        DECIMAL(5,4) DEFAULT 0.03     -- 3% default
status                      VARCHAR(32) NOT NULL          -- enum: pending_verification, active, suspended
email_verified_at           TIMESTAMPTZ
created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

Index on `slug`, `email`, `status`, `stripe_connect_account_id`.

EIN, banking info, and KYB documentation are collected by Stripe Connect Express during onboarding, not stored in this database.

### customers

End consumers. Created automatically on first plan setup.

```
id                      UUID PRIMARY KEY
email                   VARCHAR(255) UNIQUE NOT NULL
phone                   VARCHAR(32)
first_name              VARCHAR(128)
last_name               VARCHAR(128)
stripe_customer_id      VARCHAR(255) UNIQUE           -- cus_xxx, created on first plan
last_login_at           TIMESTAMPTZ
created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

Index on `email`.

### customer_cards

Card-on-file via Stripe PaymentMethods. The `stripe_payment_method_id` is the only reference; raw PAN is never stored. The card is attached to the customer's Stripe Customer record.

```
id                          UUID PRIMARY KEY
customer_id                 UUID NOT NULL REFERENCES customers(id)
stripe_payment_method_id    VARCHAR(255) UNIQUE NOT NULL   -- pm_xxx
last_four                   VARCHAR(4) NOT NULL
exp_month                   SMALLINT NOT NULL
exp_year                    SMALLINT NOT NULL
brand                       VARCHAR(32) NOT NULL          -- visa, mastercard, amex, discover
is_default                  BOOLEAN NOT NULL DEFAULT FALSE
created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
deleted_at                  TIMESTAMPTZ
```

Index on `customer_id`.

### bookings

A specific dated service the merchant is selling.

```
id                      UUID PRIMARY KEY
merchant_id             UUID NOT NULL REFERENCES merchants(id)
booking_token           VARCHAR(64) UNIQUE NOT NULL   -- URL-safe random token
service_name            VARCHAR(255) NOT NULL
service_description     TEXT
total_amount_cents      BIGINT NOT NULL
appointment_date        DATE NOT NULL
cancellation_policy     TEXT                          -- merchant's policy in plain text for v1
status                  VARCHAR(32) NOT NULL          -- enum: draft, sent, accepted, in_progress, completed, canceled
customer_id             UUID REFERENCES customers(id) -- NULL until plan accepted
customer_name_hint      VARCHAR(255)                  -- merchant's note about who this is for, optional
created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

Index on `merchant_id`, `booking_token`, `status`, `appointment_date`.

Plan options available to the customer are not stored on the booking. They are calculated at render time by `PlanEligibilityService` based on `appointment_date` and today's date. See CLAUDE.md "Plan eligibility" for the rules.

### payment_plans

The customer's committed plan against a Booking.

```
id                      UUID PRIMARY KEY
booking_id              UUID NOT NULL REFERENCES bookings(id)
customer_id             UUID NOT NULL REFERENCES customers(id)
customer_card_id        UUID NOT NULL REFERENCES customer_cards(id)
total_amount_cents      BIGINT NOT NULL
num_payments            SMALLINT NOT NULL
frequency               VARCHAR(32) NOT NULL          -- enum: weekly, biweekly, monthly
start_date              DATE NOT NULL
end_date                DATE NOT NULL
status                  VARCHAR(32) NOT NULL          -- enum: active, completed, defaulted, canceled
canceled_at             TIMESTAMPTZ
canceled_reason         TEXT
created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

Index on `booking_id`, `customer_id`, `status`.

### payment_schedule

Dated installments within a PaymentPlan.

```
id                          UUID PRIMARY KEY
payment_plan_id             UUID NOT NULL REFERENCES payment_plans(id)
sequence                    SMALLINT NOT NULL             -- 1-based ordering
due_date                    DATE NOT NULL
amount_cents                BIGINT NOT NULL
status                      VARCHAR(32) NOT NULL          -- enum: scheduled, processing, paid, failed, retrying, canceled
stripe_payment_intent_id    VARCHAR(255)                  -- pi_xxx, set when fired
attempted_at                TIMESTAMPTZ
paid_at                     TIMESTAMPTZ
retry_count                 SMALLINT NOT NULL DEFAULT 0
last_error                  TEXT
created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

Index on `payment_plan_id`, `due_date`, `status`.

Unique constraint on (`payment_plan_id`, `sequence`).

### payouts

Merchant disbursements at plan completion via Stripe Connect transfer.

```
id                      UUID PRIMARY KEY
merchant_id             UUID NOT NULL REFERENCES merchants(id)
booking_id              UUID NOT NULL REFERENCES bookings(id) UNIQUE
gross_amount_cents      BIGINT NOT NULL
fee_amount_cents        BIGINT NOT NULL
net_amount_cents        BIGINT NOT NULL
status                  VARCHAR(32) NOT NULL          -- enum: pending, processing, paid, failed
stripe_transfer_id      VARCHAR(255)                  -- tr_xxx
initiated_at            TIMESTAMPTZ
paid_at                 TIMESTAMPTZ
failure_reason          TEXT
created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

Index on `merchant_id`, `status`, `booking_id`.

### webhook_events

Outbound merchant webhook delivery log.

```
id                      UUID PRIMARY KEY
merchant_id             UUID NOT NULL REFERENCES merchants(id)
event_type              VARCHAR(64) NOT NULL          -- plan.started, payment.succeeded, payment.failed, plan.completed, plan.canceled, payout.paid
payload                 JSONB NOT NULL
status                  VARCHAR(32) NOT NULL          -- enum: pending, delivered, failed
attempts                SMALLINT NOT NULL DEFAULT 0
last_attempted_at       TIMESTAMPTZ
delivered_at            TIMESTAMPTZ
last_error              TEXT
created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

Index on `merchant_id`, `status`, `created_at`.

### notifications

Transactional email and SMS log.

```
id                      UUID PRIMARY KEY
recipient_type          VARCHAR(32) NOT NULL          -- enum: customer, merchant
recipient_id            UUID NOT NULL
channel                 VARCHAR(16) NOT NULL          -- enum: email, sms
template                VARCHAR(128) NOT NULL
payload                 JSONB NOT NULL
status                  VARCHAR(32) NOT NULL          -- enum: queued, sent, failed
sent_at                 TIMESTAMPTZ
last_error              TEXT
created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

Index on `recipient_type`, `recipient_id`, `status`.

### merchant_webhook_endpoints

Stored webhook URLs per merchant.

```
id                      UUID PRIMARY KEY
merchant_id             UUID NOT NULL REFERENCES merchants(id)
url                     VARCHAR(512) NOT NULL
signing_secret          VARCHAR(255) NOT NULL         -- HMAC signing key
event_types             TEXT[] NOT NULL               -- which events to deliver, empty array means all
is_active               BOOLEAN NOT NULL DEFAULT TRUE
created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

Index on `merchant_id`.

## State machines

### bookings.status

```
draft → sent → accepted → in_progress → completed
                       ↘ canceled
```

- `draft`: merchant created, no link sent
- `sent`: merchant has the URL but customer hasn't accepted yet
- `accepted`: customer started a plan
- `in_progress`: plan is active, payments running
- `completed`: final payment succeeded, ready for payout
- `canceled`: customer or merchant canceled

### payment_plans.status

```
active → completed
       ↘ defaulted
       ↘ canceled
```

### payment_schedule.status

```
scheduled → processing → paid
                       ↘ failed → retrying → paid
                                            ↘ failed (final)
         ↘ canceled (if plan canceled)
```

### payouts.status

```
pending → processing → paid
                     ↘ failed
```

## Money handling rules

- All amounts in integer cents (BIGINT).
- Division for installments: if `total_amount_cents` doesn't divide evenly by `num_payments`, distribute the remainder to the first N payments. Example: $4,000.00 over 6 payments. 400000 / 6 = 66666 remainder 4. So 4 payments of $666.67 and 2 of $666.66, with the higher ones first. Total always equals booking total exactly.
- Bliss fee computed at payout: `fee_amount_cents = floor(gross_amount_cents * bliss_fee_percentage)`. Never compute on individual payments.
- All amount math in Java uses BigDecimal at the boundary and Long internally.

## Privacy and PII

- Never store raw PAN. Stripe holds the card; we hold the PaymentMethod ID.
- Merchant banking info, EIN, and KYB documentation are held by Stripe Connect, not in this database.
- PII fields requiring care: customer email, phone, name; merchant address, contact info.
- All audit logging is structured and excludes PII bodies (log IDs, not content).
