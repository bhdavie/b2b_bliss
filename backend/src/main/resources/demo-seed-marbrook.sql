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

-- ===========================================================================
-- Marbrook family: one property per account-setup path
-- ===========================================================================
-- Three properties that differ ONLY in which rail they charge on. Same plan
-- rules, same branding (both nulls, as Marbrook House has always had), same
-- Hudson NY address pattern. They exist so each setup path can be demoed
-- end to end without reconfiguring a single merchant between takes.
--
--   Marbrook House  j9l29fke  pms_type mews       Mews Connector rail
--   Marbrook Grand  g7hq2wxn  pms_type cloudbeds  Cloudbeds OAuth rail
--   Marbrook Lodge  l4vt8zpc  pms_type stripe     no PMS; platform Stripe rail
--
-- Idempotent like the rest of this file: inserts key on slug / merchant_id,
-- and the one UPDATE below is a no-op once it has run.

-- Marbrook House correction ------------------------------------------------
-- The merchant INSERT above predates V17 and sets neither pms_type nor
-- onboarding_state, so a FRESH seed produced a Marbrook House on the 'stripe'
-- rail with onboarding_state 'created' — i.e. the dashboard showed the setup
-- checklist instead of a working property. The live database only reads 'mews'
-- because it was clicked through onboarding by hand, never because of a seed.
--
-- ON CONFLICT DO NOTHING cannot fix an existing row, so this is a targeted
-- UPDATE. It is idempotent: once the values match, it changes nothing.
UPDATE merchants
   SET business_name    = 'Marbrook House',
       pms_type         = 'mews',
       onboarding_state = 'active',
       status           = 'active'
 WHERE slug = 'j9l29fke'
   AND (business_name IS DISTINCT FROM 'Marbrook House'
        OR pms_type != 'mews'
        OR onboarding_state != 'active'
        OR status != 'active');

-- Marbrook House Mews connection -------------------------------------------
-- Public Mews demo credentials for the shared "Gross pricing UK" demo property.
-- The same pair already appears in BlissConfiguration.MewsPmsConfig and in
-- ConnectMewsStep.tsx; docs.mews.com states the demo environment is completely
-- public and must never hold real data, so they are safe to seed.
--
-- NOTE the currency: this shared demo enterprise reports GBP, so a Mews-rail
-- plan quotes in GBP regardless of what the rest of the demo shows in USD.
INSERT INTO merchant_mews_connections (
    merchant_id, platform_url, client_token, access_token,
    enterprise_id, enterprise_name, currency, validated_at
) VALUES (
    '9b54a488-b308-4a6d-91cc-38983ff982ac',
    'https://api.mews-demo.com',
    'E0D439EE522F44368DC78E1BFB03710C-D24FB11DBE31D4621C4817E028D9E1D',
    'C66EF7B239D24632943D115EDE9CB810-EA00F8FD8294692C940F6B5A8F9453D',
    '851df8c8-90f2-4c4a-8e01-a4fc46b25178',
    'API Hotel Gross Pricing (DO NOT CHANGE THE NAME)',
    'USD',
    now()
)
ON CONFLICT (merchant_id) DO NOTHING;

-- The seed owns the currency, the enterprise does not.
--
-- The shared demo enterprise reports GBP, but every amount in this system is a
-- Bliss-side dollar figure (plan totals come from the checkout request or
-- MewsSyncService.PLACEHOLDER_TOTAL_CENTS, never from a Mews reservation) and
-- the frontend renders USD unconditionally. Nothing converts between
-- currencies: MewsAdapter.chargeStoredCard sends Currency and GrossValue as
-- independent fields, so this string only LABELS an amount that is already
-- fixed. GBP here was mislabelling dollars as pounds, not holding a different
-- sum of money.
--
-- ON CONFLICT DO NOTHING above cannot correct a row that already exists, so
-- this is a targeted UPDATE. Idempotent: a no-op once the value is USD.
UPDATE merchant_mews_connections
   SET currency = 'USD'
 WHERE merchant_id = '9b54a488-b308-4a6d-91cc-38983ff982ac'
   AND currency IS DISTINCT FROM 'USD';

-- Marbrook Grand (Cloudbeds rail) -------------------------------------------
-- stripe_connect_account_id is UNIQUE, so each property needs its own synthetic
-- acct_demo_* value. It is set charges_enabled purely so the public merchant
-- view reports the property as ready; a Cloudbeds-rail plan never charges
-- through it.
INSERT INTO merchants (
    id, slug, email, business_name, business_type,
    address_line1, address_city, address_state, address_zip, address_country,
    stripe_connect_account_id, stripe_connect_status,
    pms_type, onboarding_state,
    status, email_verified_at
) VALUES (
    '6d3ae2b1-0000-4000-8000-000000000002',
    'g7hq2wxn',
    'demo@marbrookgrand.com',
    'Marbrook Grand',
    'hotel',
    '204 Warren Street', 'Hudson', 'NY', '12534', 'US',
    'acct_demo_2f7c93ab55e1', 'charges_enabled',
    'cloudbeds', 'active',
    'active', now()
)
ON CONFLICT (slug) DO NOTHING;

-- Marbrook Lodge (no PMS; platform Stripe rail) -----------------------------
-- Deliberately has NO merchant_stripe_connections row. That table is the
-- Standard-Connect rail added in V20, where the property is merchant of record.
-- This property runs the original Express rail through the merchants columns
-- above, exactly as Marbrook House does, which is what the pay-link flow uses.
INSERT INTO merchants (
    id, slug, email, business_name, business_type,
    address_line1, address_city, address_state, address_zip, address_country,
    stripe_connect_account_id, stripe_connect_status,
    pms_type, onboarding_state,
    status, email_verified_at
) VALUES (
    '6d3ae2b1-0000-4000-8000-000000000003',
    'l4vt8zpc',
    'demo@marbrooklodge.com',
    'Marbrook Lodge',
    'hotel',
    '46 Union Street', 'Hudson', 'NY', '12534', 'US',
    'acct_demo_9c41e6d70b2a', 'charges_enabled',
    'stripe', 'active',
    'active', now()
)
ON CONFLICT (slug) DO NOTHING;

-- Plan rules for the two new properties -------------------------------------
-- Copied from Marbrook House's LIVE row, not from the rules INSERT earlier in
-- this file: that block sets refund_policy 'credit_only' while the live row
-- reads 'full', so the file and the database have diverged. Every column is
-- listed explicitly here rather than leaning on schema defaults, so "the same
-- rules as Marbrook House" stays true even if a default changes.
--
-- payment_due_custom_months is DAYS, not months (V15 changed the unit and left
-- the column name for wire compatibility). 2 = two days before check-in.
INSERT INTO merchant_plan_rules (
    id, merchant_id,
    min_lead_time_weeks, max_lead_time_weeks, allowed_frequencies,
    min_booking_amount_cents, max_booking_amount_cents, recommended_frequency,
    deposit_required, deposit_type, deposit_value, deposit_max_cents,
    refund_policy, cancellation_fee_enabled, late_fee_enabled,
    payment_due_policy, payment_due_custom_months,
    retry_attempts, retry_spacing_days, after_retries_action,
    discount_basis_points
) VALUES
    ('6d3ae2b1-1111-4000-8000-000000000002', '6d3ae2b1-0000-4000-8000-000000000002',
     6, NULL, 'both',
     NULL, NULL, NULL,
     FALSE, NULL, NULL, NULL,
     'full', FALSE, FALSE,
     'custom_months', 2,
     3, 3, 'treat_as_cancellation',
     0),
    ('6d3ae2b1-1111-4000-8000-000000000003', '6d3ae2b1-0000-4000-8000-000000000003',
     6, NULL, 'both',
     NULL, NULL, NULL,
     FALSE, NULL, NULL, NULL,
     'full', FALSE, FALSE,
     'custom_months', 2,
     3, 3, 'treat_as_cancellation',
     0)
ON CONFLICT (merchant_id) DO NOTHING;

-- Marbrook Grand Cloudbeds connection ---------------------------------------
-- Synthetic tokens: no Cloudbeds object backs these, matching the pm_seed_*
-- convention used for cards above. Enough for the dashboard to report the
-- property as connected and for CloudbedsAdapterFactory to resolve a row.
--
-- access_token_expires_at is relative to seed time rather than a fixed
-- timestamp, so re-seeding a stale database does not produce an
-- already-expired connection.
INSERT INTO merchant_cloudbeds_connections (
    merchant_id, property_id, property_name, currency,
    access_token, refresh_token, access_token_expires_at,
    status, connected_at
) VALUES (
    '6d3ae2b1-0000-4000-8000-000000000002',
    'cb_demo_property_318842',
    'Marbrook Grand',
    'USD',
    'cb_seed_access_token_marbrook_grand',
    'cb_seed_refresh_token_marbrook_grand',
    now() + interval '365 days',
    'connected',
    now()
)
ON CONFLICT (merchant_id) DO NOTHING;
