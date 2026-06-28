-- Demo seed: Hawthorn at Camden, fully-paid Harbor View Room stay tied to
-- john@example.com. Mirrors the exact booking + Monthly plan numbers the
-- /checkout demo generates (Harbor View Room, 2 nights, total $876.80,
-- deposit $105.68, 4 monthly installments of $192.78) so the slide deck
-- reads consistently — same room, same dollars, same dates — with the
-- plan in the terminal COMPLETED state.
--
-- Idempotent via fixed UUIDs + ON CONFLICT. NOT a Flyway migration.
-- Run manually via:
--   psql -d bliss -f backend/src/main/resources/demo-seed-hawthorn-complete.sql
--
-- Reset/refresh: DELETE-cascade from the IDs at the bottom of this file.

BEGIN;

-- Ensure the customer row exists. The /account/login flow creates this on
-- first sign-in, but the seed shouldn't assume that's happened yet.
INSERT INTO customers (email, first_name, last_name)
VALUES ('john@example.com', 'John', 'Doe')
ON CONFLICT (email) DO NOTHING;

-- Customer card for this completed plan (synthetic pm_demo_* id, distinct
-- from any other Hawthorn cards already in the DB).
INSERT INTO customer_cards (
    id, customer_id, stripe_payment_method_id,
    last_four, exp_month, exp_year, brand, is_default
) VALUES (
    'bbbbbbbb-5555-5555-5555-555555555555',
    (SELECT id FROM customers WHERE email = 'john@example.com'),
    'pm_demo_hawthorncomplete',
    '4242', 12, 2030, 'visa', FALSE
)
ON CONFLICT (id) DO NOTHING;

-- Booking — Harbor View Room, 2 nights, check-in 2026-09-11. Same room
-- and dates as the active Monthly demo plan; only difference here is the
-- terminal COMPLETED status (and corresponding all-paid schedule below).
--
-- Money matches the live Monthly plan exactly:
--   subtotal (2 nights × $425)          = $850.00
--   +12% taxes & fees                   = $102.00
--   original_total                      = $952.00  (95,200 cents)
--   −10% Bliss discount                 = −$95.20
--   discounted total_amount             = $856.80  (85,680 cents)
INSERT INTO bookings (
    id, merchant_id, booking_token, service_name,
    total_amount_cents, original_total_cents,
    appointment_date, checkout_date,
    status, booking_source, customer_id,
    customer_name_hint, customer_email_hint
) VALUES (
    'bbbbbbbb-3333-3333-3333-333333333333',
    (SELECT id FROM merchants WHERE slug = 'hawthorn-camden'),
    'HawthornComplete01',
    'Harbor View Room, 2 nights',
    85680,     -- discounted total ($856.80)
    95200,     -- original total ($952.00)
    DATE '2026-09-11',
    DATE '2026-09-13',
    'completed',
    'customer_initiated',
    (SELECT id FROM customers WHERE email = 'john@example.com'),
    'John Doe',
    'john@example.com'
)
ON CONFLICT (id) DO NOTHING;

-- Payment plan — deposit + 4 monthly installments, all paid. status =
-- 'completed' (terminal per PaymentPlanStateMachine: ACTIVE -> COMPLETED
-- when the final installment clears).
--
-- Dates match the live Monthly plan exactly:
--   start_date   = 2026-05-31  (deposit charged the day plan was set up)
--   installment1 = 2026-06-01
--   installment2 = 2026-07-01
--   installment3 = 2026-08-01
--   end_date     = 2026-09-01  (last installment, 10 days pre-check-in)
INSERT INTO payment_plans (
    id, booking_id, customer_id, customer_card_id,
    total_amount_cents, num_payments, frequency,
    start_date, end_date, deposit_amount_cents, status
) VALUES (
    'bbbbbbbb-4444-4444-4444-444444444444',
    'bbbbbbbb-3333-3333-3333-333333333333',
    (SELECT id FROM customers WHERE email = 'john@example.com'),
    'bbbbbbbb-5555-5555-5555-555555555555',
    85680,     -- discounted total ($856.80)
    4,         -- 4 monthly installments after deposit
    'monthly',
    DATE '2026-05-31',
    DATE '2026-09-01',
    8568,      -- base deposit pre-fee ($85.68 = 10% of discounted)
    'completed'
)
ON CONFLICT (id) DO NOTHING;

-- Schedule — 5 paid rows. Math:
--   deposit row      = 8,568 + 2,000 (fee) = 10,568  ($105.68)
--   per installment  = (85,680 - 8,568) / 4 = 19,278  ($192.78)
--   sum              = 10,568 + 4*19,278 = 87,680  =  85,680 + 2,000 fee ✓
--
-- paid_at is pinned to the due_date for each row (model: customer paid on
-- schedule). Some installment dates land in the future relative to "today"
-- (2026-05-31) — that's mechanically valid for TIMESTAMPTZ and reflects
-- the deliberate trade of matching the live Monthly demo plan dates.
INSERT INTO payment_schedule (
    id, payment_plan_id, sequence, due_date, amount_cents,
    status, kind, stripe_payment_intent_id,
    attempted_at, paid_at
) VALUES
    (
        'bbbbbbbb-6666-6666-6666-666666666661',
        'bbbbbbbb-4444-4444-4444-444444444444',
        1, DATE '2026-05-31', 10568,
        'paid', 'deposit', 'pi_demo_hawthorncompletedep',
        TIMESTAMPTZ '2026-05-31 12:00:00-04', TIMESTAMPTZ '2026-05-31 12:00:01-04'
    ),
    (
        'bbbbbbbb-6666-6666-6666-666666666662',
        'bbbbbbbb-4444-4444-4444-444444444444',
        2, DATE '2026-06-01', 19278,
        'paid', 'installment', 'pi_demo_hawthorncompleteins1',
        TIMESTAMPTZ '2026-06-01 09:00:00-04', TIMESTAMPTZ '2026-06-01 09:00:01-04'
    ),
    (
        'bbbbbbbb-6666-6666-6666-666666666663',
        'bbbbbbbb-4444-4444-4444-444444444444',
        3, DATE '2026-07-01', 19278,
        'paid', 'installment', 'pi_demo_hawthorncompleteins2',
        TIMESTAMPTZ '2026-07-01 09:00:00-04', TIMESTAMPTZ '2026-07-01 09:00:01-04'
    ),
    (
        'bbbbbbbb-6666-6666-6666-666666666664',
        'bbbbbbbb-4444-4444-4444-444444444444',
        4, DATE '2026-08-01', 19278,
        'paid', 'installment', 'pi_demo_hawthorncompleteins3',
        TIMESTAMPTZ '2026-08-01 09:00:00-04', TIMESTAMPTZ '2026-08-01 09:00:01-04'
    ),
    (
        'bbbbbbbb-6666-6666-6666-666666666665',
        'bbbbbbbb-4444-4444-4444-444444444444',
        5, DATE '2026-09-01', 19278,
        'paid', 'installment', 'pi_demo_hawthorncompleteins4',
        TIMESTAMPTZ '2026-09-01 09:00:00-04', TIMESTAMPTZ '2026-09-01 09:00:01-04'
    )
ON CONFLICT (id) DO NOTHING;

COMMIT;

-- To reset:
--   DELETE FROM payment_schedule WHERE payment_plan_id = 'bbbbbbbb-4444-4444-4444-444444444444';
--   DELETE FROM payment_plans WHERE id = 'bbbbbbbb-4444-4444-4444-444444444444';
--   DELETE FROM bookings WHERE id = 'bbbbbbbb-3333-3333-3333-333333333333';
--   DELETE FROM customer_cards WHERE id = 'bbbbbbbb-5555-5555-5555-555555555555';
