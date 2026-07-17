-- Demo seed: Marbrook House merchant + the five fixture bookings that give the
-- dashboard and the consumer portal one of each plan state to render.
--
-- Executed by the seed-demo command (SeedDemoCommand), NOT by Flyway and NOT by
-- psql. It never runs implicitly: demo data only appears when someone invokes
--   java -jar <jar> seed-demo <config.yml>
--
-- Idempotent throughout. Bookings key on their token, customers on email,
-- everything else on its fixed UUID, and every insert is ON CONFLICT DO NOTHING,
-- so a re-run adds only what is missing and never duplicates.
--
-- Customer FKs resolve through a subselect on email rather than the fixed UUID
-- below: if a customer row already exists for that address, its real id wins and
-- the fixed id is simply not used.
--
-- Fixed UUID scheme, mirroring the local demo database:
--   merchant         9b54a488-b308-4a6d-91cc-38983ff982ac
--   plan rules       d7f3e4c4-f3eb-44bd-9540-d696acd28326
--   customers        11111111-0000-4000-8000-00000000000N
--   customer_cards   22222222-0000-4000-8000-00000000000N
--   bookings         33333333-0000-4000-8000-00000000000N
--   payment_plans    44444444-0000-4000-8000-00000000000N
--   payment_schedule 55555555-0000-4000-8000-00000000PPSS  (PP=plan, SS=sequence)
--
-- Money is integer cents. Amounts, dates and statuses are copied verbatim from
-- the local demo database.

-- Merchant -----------------------------------------------------------------
-- charges_enabled against a synthetic acct_demo_* account, mirroring what the
-- demo-complete onboarding path mints, so the dashboard renders fully while
-- Stripe stays in demo mode (blank STRIPE_SECRET_KEY).
INSERT INTO merchants (
    id, slug, email, business_name, business_type,
    address_line1, address_city, address_state, address_zip, address_country,
    stripe_connect_account_id, stripe_connect_status,
    status, email_verified_at
) VALUES (
    '9b54a488-b308-4a6d-91cc-38983ff982ac',
    'j9l29fke',
    'demo@marbrookhouse.com',
    'Marbrook House',
    'hotel',
    '118 Greenwich Avenue', 'Hudson', 'NY', '12534', 'US',
    'acct_demo_8d0f801440de', 'charges_enabled',
    'active', now()
)
ON CONFLICT (slug) DO NOTHING;

-- Merchant plan rules ------------------------------------------------------
-- Only the settings that differ from the schema defaults are listed; the rest
-- (both frequencies, no deposit, 3 retries every 3 days, treat-as-cancellation,
-- no discount) already match Marbrook.
--
-- payment_due_custom_months is a stale column name: V15 changed the unit to
-- days, so 2 means two days before check-in.
INSERT INTO merchant_plan_rules (
    id, merchant_id,
    min_lead_time_weeks, allowed_frequencies,
    deposit_required, discount_basis_points,
    refund_policy,
    payment_due_policy, payment_due_custom_months,
    retry_attempts, retry_spacing_days,
    after_retries_action
) VALUES (
    'd7f3e4c4-f3eb-44bd-9540-d696acd28326',
    '9b54a488-b308-4a6d-91cc-38983ff982ac',
    6, 'both',
    FALSE, 0,
    'credit_only',
    'custom_months', 2,
    3, 3,
    'treat_as_cancellation'
)
ON CONFLICT (merchant_id) DO NOTHING;

-- Customers ----------------------------------------------------------------
-- One per fixture. Portal sign-in is demo-mode (CustomerAuthService only checks
-- the email exists; the password is accepted but never verified), so seeding
-- these rows is what makes /account reachable for each.
INSERT INTO customers (id, email, first_name, last_name) VALUES
    ('11111111-0000-4000-8000-000000000001', 'saoirse.byrne+seed@example.com',      'Saoirse', 'Byrne'),
    ('11111111-0000-4000-8000-000000000002', 'hugo.vance+seed@example.com',         'Hugo',    'Vance'),
    ('11111111-0000-4000-8000-000000000003', 'lena.okonkwo+seed@example.com',       'Lena',    'Okonkwo'),
    ('11111111-0000-4000-8000-000000000004', 'marcus.bellweather+seed@example.com', 'Marcus',  'Bellweather'),
    ('11111111-0000-4000-8000-000000000005', 'priya.raman+seed@example.com',        'Priya',   'Raman')
ON CONFLICT (email) DO NOTHING;

-- Customer cards -----------------------------------------------------------
-- Synthetic pm_seed_* ids: no Stripe object backs these, matching the local
-- fixtures.
INSERT INTO customer_cards (
    id, customer_id, stripe_payment_method_id, last_four, exp_month, exp_year, brand, is_default
) VALUES
    ('22222222-0000-4000-8000-000000000001',
     (SELECT id FROM customers WHERE email = 'saoirse.byrne+seed@example.com'),
     'pm_seed_001', '4242', 12, 2030, 'visa', TRUE),
    ('22222222-0000-4000-8000-000000000002',
     (SELECT id FROM customers WHERE email = 'hugo.vance+seed@example.com'),
     'pm_seed_002', '4242', 12, 2030, 'visa', TRUE),
    ('22222222-0000-4000-8000-000000000003',
     (SELECT id FROM customers WHERE email = 'lena.okonkwo+seed@example.com'),
     'pm_seed_003', '4242', 12, 2030, 'visa', TRUE),
    ('22222222-0000-4000-8000-000000000004',
     (SELECT id FROM customers WHERE email = 'marcus.bellweather+seed@example.com'),
     'pm_seed_004', '4242', 12, 2030, 'visa', TRUE),
    ('22222222-0000-4000-8000-000000000005',
     (SELECT id FROM customers WHERE email = 'priya.raman+seed@example.com'),
     'pm_seed_005', '4242', 12, 2030, 'visa', TRUE)
ON CONFLICT (id) DO NOTHING;

-- Bookings -----------------------------------------------------------------
-- created_at is set explicitly: the dashboard orders by it, so letting it
-- default to now() would collapse all five into one timestamp.
INSERT INTO bookings (
    id, merchant_id, booking_token, service_name,
    total_amount_cents, appointment_date,
    status, booking_source, customer_id,
    customer_name_hint, customer_email_hint, created_at
) VALUES
    -- Active: one installment paid, three still ahead.
    ('33333333-0000-4000-8000-000000000001',
     '9b54a488-b308-4a6d-91cc-38983ff982ac',
     'seed-active-001', 'King with Terrace · Best flexible rate',
     294000, DATE '2026-11-25',
     'accepted', 'merchant_initiated',
     (SELECT id FROM customers WHERE email = 'saoirse.byrne+seed@example.com'),
     'Saoirse Byrne', 'saoirse.byrne+seed@example.com',
     TIMESTAMPTZ '2026-06-27 08:00:00-04'),
    -- Late: installment 2 came due 2026-06-12 and is still scheduled.
    ('33333333-0000-4000-8000-000000000002',
     '9b54a488-b308-4a6d-91cc-38983ff982ac',
     'seed-late-001', 'Garden Suite · Advance purchase rate',
     231000, DATE '2026-10-10',
     'in_progress', 'merchant_initiated',
     (SELECT id FROM customers WHERE email = 'hugo.vance+seed@example.com'),
     'Hugo Vance', 'hugo.vance+seed@example.com',
     TIMESTAMPTZ '2026-06-20 05:30:00-04'),
    -- Paid: plan complete, stay still ahead.
    ('33333333-0000-4000-8000-000000000003',
     '9b54a488-b308-4a6d-91cc-38983ff982ac',
     'seed-paid-001', 'King with Terrace · Best flexible rate',
     196000, DATE '2026-09-15',
     'completed', 'merchant_initiated',
     (SELECT id FROM customers WHERE email = 'lena.okonkwo+seed@example.com'),
     'Lena Okonkwo', 'lena.okonkwo+seed@example.com',
     TIMESTAMPTZ '2026-06-05 10:00:00-04'),
    -- Cancelled mid-plan: one paid, the rest canceled.
    ('33333333-0000-4000-8000-000000000004',
     '9b54a488-b308-4a6d-91cc-38983ff982ac',
     'seed-cancelled-001', 'Garden Suite · Best flexible rate',
     315000, DATE '2026-08-01',
     'canceled', 'merchant_initiated',
     (SELECT id FROM customers WHERE email = 'marcus.bellweather+seed@example.com'),
     'Marcus Bellweather', 'marcus.bellweather+seed@example.com',
     TIMESTAMPTZ '2026-05-28 06:00:00-04'),
    -- Trip taken: plan complete and the stay is in the past.
    ('33333333-0000-4000-8000-000000000005',
     '9b54a488-b308-4a6d-91cc-38983ff982ac',
     'seed-trip-001', 'King with Terrace · Advance purchase rate',
     252000, DATE '2026-05-15',
     'completed', 'merchant_initiated',
     (SELECT id FROM customers WHERE email = 'priya.raman+seed@example.com'),
     'Priya Raman', 'priya.raman+seed@example.com',
     TIMESTAMPTZ '2026-05-12 07:00:00-04')
ON CONFLICT (booking_token) DO NOTHING;

-- Payment plans ------------------------------------------------------------
-- No deposits on any fixture; processing_fee_cents is 5% of the total, matching
-- PlanCreationService.BLISS_FEE_RATE.
INSERT INTO payment_plans (
    id, booking_id, customer_id, customer_card_id,
    total_amount_cents, num_payments, frequency,
    start_date, end_date, deposit_amount_cents, processing_fee_cents,
    status, canceled_at, canceled_reason, created_at
) VALUES
    ('44444444-0000-4000-8000-000000000001',
     '33333333-0000-4000-8000-000000000001',
     (SELECT id FROM customers WHERE email = 'saoirse.byrne+seed@example.com'),
     '22222222-0000-4000-8000-000000000001',
     294000, 4, 'monthly',
     DATE '2026-06-15', DATE '2026-11-02', 0, 14700,
     'active', NULL, NULL, TIMESTAMPTZ '2026-06-27 08:00:00-04'),
    ('44444444-0000-4000-8000-000000000002',
     '33333333-0000-4000-8000-000000000002',
     (SELECT id FROM customers WHERE email = 'hugo.vance+seed@example.com'),
     '22222222-0000-4000-8000-000000000002',
     231000, 4, 'monthly',
     DATE '2026-05-29', DATE '2026-10-02', 0, 11550,
     'active', NULL, NULL, TIMESTAMPTZ '2026-06-20 05:30:00-04'),
    ('44444444-0000-4000-8000-000000000003',
     '33333333-0000-4000-8000-000000000003',
     (SELECT id FROM customers WHERE email = 'lena.okonkwo+seed@example.com'),
     '22222222-0000-4000-8000-000000000003',
     196000, 3, 'monthly',
     DATE '2026-04-02', DATE '2026-06-02', 0, 9800,
     'completed', NULL, NULL, TIMESTAMPTZ '2026-06-05 10:00:00-04'),
    ('44444444-0000-4000-8000-000000000004',
     '33333333-0000-4000-8000-000000000004',
     (SELECT id FROM customers WHERE email = 'marcus.bellweather+seed@example.com'),
     '22222222-0000-4000-8000-000000000004',
     315000, 4, 'monthly',
     DATE '2026-05-02', DATE '2026-08-02', 0, 15750,
     'canceled', TIMESTAMPTZ '2026-06-01 20:00:00-04', 'customer_initiated',
     TIMESTAMPTZ '2026-05-28 06:00:00-04'),
    ('44444444-0000-4000-8000-000000000005',
     '33333333-0000-4000-8000-000000000005',
     (SELECT id FROM customers WHERE email = 'priya.raman+seed@example.com'),
     '22222222-0000-4000-8000-000000000005',
     252000, 4, 'monthly',
     DATE '2026-02-15', DATE '2026-05-02', 0, 12600,
     'completed', NULL, NULL, TIMESTAMPTZ '2026-05-12 07:00:00-04')
ON CONFLICT (id) DO NOTHING;

-- Payment schedule ---------------------------------------------------------
-- stripe_payment_intent_id is left NULL on every row, matching the local
-- fixtures: these were written directly rather than through the demo charge
-- path, so no pi_demo_* id was ever minted.
--
-- Plan 1 (active):    73,500 x 4 = 294,000
-- Plan 2 (late):      57,750 x 4 = 231,000
-- Plan 3 (paid):      65,333 + 65,333 + 65,334 = 196,000  (remainder on the last)
-- Plan 4 (cancelled): 78,750 x 4 = 315,000
-- Plan 5 (trip):      63,000 x 4 = 252,000
INSERT INTO payment_schedule (
    id, payment_plan_id, sequence, due_date, amount_cents, status, kind, paid_at
) VALUES
    -- Plan 1: installment 1 paid, 2-4 ahead.
    ('55555555-0000-4000-8000-000000000101', '44444444-0000-4000-8000-000000000001',
     1, DATE '2026-06-15', 73500, 'paid',      'installment', TIMESTAMPTZ '2026-06-15 08:00:00-04'),
    ('55555555-0000-4000-8000-000000000102', '44444444-0000-4000-8000-000000000001',
     2, DATE '2026-09-02', 73500, 'scheduled', 'installment', NULL),
    ('55555555-0000-4000-8000-000000000103', '44444444-0000-4000-8000-000000000001',
     3, DATE '2026-10-02', 73500, 'scheduled', 'installment', NULL),
    ('55555555-0000-4000-8000-000000000104', '44444444-0000-4000-8000-000000000001',
     4, DATE '2026-11-02', 73500, 'scheduled', 'installment', NULL),

    -- Plan 2: installment 1 paid; installment 2 is past due and still scheduled.
    ('55555555-0000-4000-8000-000000000201', '44444444-0000-4000-8000-000000000002',
     1, DATE '2026-05-29', 57750, 'paid',      'installment', TIMESTAMPTZ '2026-05-29 08:00:00-04'),
    ('55555555-0000-4000-8000-000000000202', '44444444-0000-4000-8000-000000000002',
     2, DATE '2026-06-12', 57750, 'scheduled', 'installment', NULL),
    ('55555555-0000-4000-8000-000000000203', '44444444-0000-4000-8000-000000000002',
     3, DATE '2026-09-12', 57750, 'scheduled', 'installment', NULL),
    ('55555555-0000-4000-8000-000000000204', '44444444-0000-4000-8000-000000000002',
     4, DATE '2026-10-02', 57750, 'scheduled', 'installment', NULL),

    -- Plan 3: fully paid.
    ('55555555-0000-4000-8000-000000000301', '44444444-0000-4000-8000-000000000003',
     1, DATE '2026-04-02', 65333, 'paid', 'installment', TIMESTAMPTZ '2026-04-02 08:00:00-04'),
    ('55555555-0000-4000-8000-000000000302', '44444444-0000-4000-8000-000000000003',
     2, DATE '2026-05-02', 65333, 'paid', 'installment', TIMESTAMPTZ '2026-05-02 08:00:00-04'),
    ('55555555-0000-4000-8000-000000000303', '44444444-0000-4000-8000-000000000003',
     3, DATE '2026-06-02', 65334, 'paid', 'installment', TIMESTAMPTZ '2026-06-02 08:00:00-04'),

    -- Plan 4: installment 1 paid, the rest canceled with the plan.
    ('55555555-0000-4000-8000-000000000401', '44444444-0000-4000-8000-000000000004',
     1, DATE '2026-05-02', 78750, 'paid',     'installment', TIMESTAMPTZ '2026-05-02 08:00:00-04'),
    ('55555555-0000-4000-8000-000000000402', '44444444-0000-4000-8000-000000000004',
     2, DATE '2026-06-02', 78750, 'canceled', 'installment', NULL),
    ('55555555-0000-4000-8000-000000000403', '44444444-0000-4000-8000-000000000004',
     3, DATE '2026-07-02', 78750, 'canceled', 'installment', NULL),
    ('55555555-0000-4000-8000-000000000404', '44444444-0000-4000-8000-000000000004',
     4, DATE '2026-08-02', 78750, 'canceled', 'installment', NULL),

    -- Plan 5: fully paid, stay already taken.
    ('55555555-0000-4000-8000-000000000501', '44444444-0000-4000-8000-000000000005',
     1, DATE '2026-02-15', 63000, 'paid', 'installment', TIMESTAMPTZ '2026-02-15 07:00:00-05'),
    ('55555555-0000-4000-8000-000000000502', '44444444-0000-4000-8000-000000000005',
     2, DATE '2026-03-15', 63000, 'paid', 'installment', TIMESTAMPTZ '2026-03-15 08:00:00-04'),
    ('55555555-0000-4000-8000-000000000503', '44444444-0000-4000-8000-000000000005',
     3, DATE '2026-04-15', 63000, 'paid', 'installment', TIMESTAMPTZ '2026-04-15 08:00:00-04'),
    ('55555555-0000-4000-8000-000000000504', '44444444-0000-4000-8000-000000000005',
     4, DATE '2026-05-02', 63000, 'paid', 'installment', TIMESTAMPTZ '2026-05-02 08:00:00-04')
ON CONFLICT (payment_plan_id, sequence) DO NOTHING;
