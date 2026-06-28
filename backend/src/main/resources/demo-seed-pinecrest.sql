-- Demo seed: Pinecrest Lodge merchant + a partially-paid plan tied to
-- john@example.com so the customer /account index has two cards from two
-- distinct merchants. Idempotent via fixed UUIDs + ON CONFLICT.
--
-- NOT a Flyway migration — run manually via:
--   psql -d bliss -f backend/src/main/resources/demo-seed-pinecrest.sql
--
-- Reset/refresh: DELETE-cascade from the IDs at the bottom of this file.

BEGIN;

-- Merchant ----------------------------------------------------------------
INSERT INTO merchants (
    id, slug, email, business_name, business_type,
    stripe_connect_status, status
) VALUES (
    'aaaaaaaa-1111-1111-1111-111111111111',
    'pinecrest-lodge',
    'hello@pinecrestlodge.test',
    'Pinecrest Lodge',
    'hotel',
    'charges_enabled',
    'active'
)
ON CONFLICT (id) DO NOTHING;

-- Merchant plan rules (10% deposit, 10% Bliss discount — same shape as
-- Hawthorn so the math story tracks; only the room rate differs)
INSERT INTO merchant_plan_rules (
    id, merchant_id, min_lead_time_weeks, allowed_frequencies,
    recommended_frequency, deposit_required, deposit_type, deposit_value,
    discount_basis_points
) VALUES (
    'aaaaaaaa-2222-2222-2222-222222222222',
    'aaaaaaaa-1111-1111-1111-111111111111',
    6, 'both', 'monthly',
    TRUE, 'percentage', 10,
    1000
)
ON CONFLICT (id) DO NOTHING;

-- Customer card for the Pinecrest plan (synthetic pm_demo_* id, distinct
-- from the Hawthorn card so the two plans look like two real bookings)
INSERT INTO customer_cards (
    id, customer_id, stripe_payment_method_id,
    last_four, exp_month, exp_year, brand, is_default
) VALUES (
    'aaaaaaaa-5555-5555-5555-555555555555',
    (SELECT id FROM customers WHERE email = 'john@example.com'),
    'pm_demo_pinecrestcard',
    '4242', 12, 2030, 'visa', FALSE
)
ON CONFLICT (id) DO NOTHING;

-- Booking — Lakeside Cabin, 3 nights, check-in 2026-07-24 (8 weeks out)
INSERT INTO bookings (
    id, merchant_id, booking_token, service_name,
    total_amount_cents, original_total_cents,
    appointment_date, checkout_date,
    status, booking_source, customer_id,
    customer_name_hint, customer_email_hint
) VALUES (
    'aaaaaaaa-3333-3333-3333-333333333333',
    'aaaaaaaa-1111-1111-1111-111111111111',
    'PinecrestDemo01',
    'Lakeside Cabin, 3 nights',
    108000,    -- discounted total ($1,080)
    120000,    -- original total ($1,200)
    DATE '2026-07-24',
    DATE '2026-07-27',
    'accepted',
    'customer_initiated',
    (SELECT id FROM customers WHERE email = 'john@example.com'),
    'John Doe',
    'john@example.com'
)
ON CONFLICT (id) DO NOTHING;

-- Payment plan — 2 monthly installments after deposit; partially paid
INSERT INTO payment_plans (
    id, booking_id, customer_id, customer_card_id,
    total_amount_cents, num_payments, frequency,
    start_date, end_date, deposit_amount_cents, processing_fee_cents, status
) VALUES (
    'aaaaaaaa-4444-4444-4444-444444444444',
    'aaaaaaaa-3333-3333-3333-333333333333',
    (SELECT id FROM customers WHERE email = 'john@example.com'),
    'aaaaaaaa-5555-5555-5555-555555555555',
    108000,    -- discounted total ($1,080)
    2,         -- 2 monthly installments after deposit
    'monthly',
    DATE '2026-05-28',  -- start (deposit fired today)
    DATE '2026-07-01',  -- end (last installment)
    10800,     -- base deposit pre-fee ($108)
    2000,      -- legacy flat fee ($20); this is a pre-migration demo plan
    'active'
)
ON CONFLICT (id) DO NOTHING;

-- Schedule — deposit + 2 installments. Deposit + first installment paid;
-- second installment still scheduled, so the /account card shows
-- "Next payment: Jul 1".
--
-- Math check:
--   deposit row = 10,800 + 2,000 (fee) = 12,800 ($128)
--   per-installment = (108,000 - 10,800) / 2 = 48,600 ($486)
--   sum: 128 + 486 + 486 = 1,100 = discounted total (1,080) + fee (20)
INSERT INTO payment_schedule (
    id, payment_plan_id, sequence, due_date, amount_cents,
    status, kind, stripe_payment_intent_id,
    attempted_at, paid_at
) VALUES
    (
        'aaaaaaaa-6666-6666-6666-666666666661',
        'aaaaaaaa-4444-4444-4444-444444444444',
        1, DATE '2026-05-28', 12800,
        'paid', 'deposit', 'pi_demo_pinecrestdep1',
        TIMESTAMPTZ '2026-05-28 12:00:00-04', TIMESTAMPTZ '2026-05-28 12:00:01-04'
    ),
    (
        'aaaaaaaa-6666-6666-6666-666666666662',
        'aaaaaaaa-4444-4444-4444-444444444444',
        2, DATE '2026-06-01', 48600,
        'paid', 'installment', 'pi_demo_pinecrestins1',
        TIMESTAMPTZ '2026-06-01 09:00:00-04', TIMESTAMPTZ '2026-06-01 09:00:01-04'
    ),
    (
        'aaaaaaaa-6666-6666-6666-666666666663',
        'aaaaaaaa-4444-4444-4444-444444444444',
        3, DATE '2026-07-01', 48600,
        'scheduled', 'installment', NULL,
        NULL, NULL
    )
ON CONFLICT (id) DO NOTHING;

COMMIT;

-- To reset:
--   DELETE FROM payment_schedule WHERE payment_plan_id = 'aaaaaaaa-4444-4444-4444-444444444444';
--   DELETE FROM payment_plans WHERE id = 'aaaaaaaa-4444-4444-4444-444444444444';
--   DELETE FROM bookings WHERE id = 'aaaaaaaa-3333-3333-3333-333333333333';
--   DELETE FROM customer_cards WHERE id = 'aaaaaaaa-5555-5555-5555-555555555555';
--   DELETE FROM merchant_plan_rules WHERE merchant_id = 'aaaaaaaa-1111-1111-1111-111111111111';
--   DELETE FROM merchants WHERE id = 'aaaaaaaa-1111-1111-1111-111111111111';
