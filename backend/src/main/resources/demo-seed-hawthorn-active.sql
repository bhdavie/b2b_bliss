-- Demo seed: Hawthorn at Camden, IN-FLIGHT Harbor View Room stay tied to
-- john@example.com. The sibling of demo-seed-hawthorn-complete.sql: same room,
-- same money, same cadence — but stopped mid-plan so the guest portal timeline
-- renders all three of its states at once:
--
--   deposit        2026-05-31  paid       $105.68   <- violet node, lavender rail
--   installment 1  2026-06-16  paid       $192.78   <- violet node
--   installment 2  2026-07-16  paid       $192.78   <- violet node
--   installment 3  2026-08-16  scheduled  $192.78   <- violet ring = NEXT PAYMENT
--   installment 4  2026-09-16  scheduled  $192.78   <- sand node
--
-- Money (identical to the completed sibling):
--   subtotal (2 nights x $425)  = $850.00
--   +12% taxes & fees           = $102.00
--   original_total              = $952.00   (95,200 cents)
--   -10% Bliss discount         = -$95.20
--   discounted total_amount     = $856.80   (85,680 cents)
--   deposit row  = 8,568 base + 2,000 fee  = 10,568  ($105.68)
--   per installment = (85,680 - 8,568) / 4 = 19,278  ($192.78)
--   schedule sum = 10,568 + 4*19,278 = 87,680 = 85,680 + 2,000 fee  ✓
--   paid so far  = 10,568 + 2*19,278 = 49,124  ($491.24)
--
-- WHY THIS FILE EXISTS: the plan below was created at runtime on one laptop and
-- lived in no seed, so a fresh database lost it and the portal had no in-flight
-- plan to render. Its rows had also drifted — the three paid rows carried
-- due dates in Nov 2026 / Jan 2027 with paid_at timestamps months EARLIER, from
-- a hand-applied UPDATE. A paid row dated in the future is incoherent on its
-- face and, since PlanProgress reads row status, showed three PAID labels
-- against a $0.00 paid-to-date figure.
--
-- Every paid row's attempted_at/paid_at now sits on or seconds after its own
-- due date. The original pi_demo_* intent ids are preserved.
--
-- IDs are the real runtime UUIDs rather than fresh fixed ones, deliberately: on
-- a machine that already has this plan the INSERTs no-op and the UPDATEs at the
-- foot correct it in place, instead of leaving a duplicate active Hawthorn plan
-- beside it.
--
-- Idempotent via fixed UUIDs + ON CONFLICT, then targeted UPDATEs that are a
-- no-op once the values already match. NOT a Flyway migration.
-- Run manually via:
--   psql -d bliss -f backend/src/main/resources/demo-seed-hawthorn-active.sql
--
-- Reset/refresh: DELETE-cascade from the IDs at the bottom of this file.

BEGIN;

-- Merchant. demo-seed-hawthorn-complete.sql only ever SELECTs this row by slug
-- and never creates it, so on a clean database that seed inserts a booking with
-- a NULL merchant_id and fails its NOT NULL constraint. Creating it here makes
-- both Hawthorn seeds work from empty. Values mirror the live demo merchant;
-- the Connect account id is a demo acct_* that never receives a real transfer.
INSERT INTO merchants (
    id, slug, business_name, business_type, email, phone,
    address_line1, address_city, address_state, address_zip, address_country,
    stripe_connect_account_id, stripe_connect_status, bliss_fee_percentage,
    status, email_verified_at, pms_type, onboarding_state
) VALUES (
    'cc78d7ec-d61d-4415-a14c-424af1b533b8',
    'hawthorn-camden',
    'The Hawthorn at Camden',
    'hotel',
    'bhdavie@gmail.com',
    '9149073795',
    '34 Berry Street', 'New York', 'NY', '11249', 'US',
    'acct_1TXMXQPsUZOjSiTB', 'charges_enabled', 0.0300,
    'active', TIMESTAMPTZ '2026-05-13 20:07:17-04', 'stripe', 'active'
)
ON CONFLICT (id) DO NOTHING;

-- Customer. The /account/login flow creates this on first sign-in, but the
-- seed shouldn't assume that has happened yet.
INSERT INTO customers (id, email, first_name, last_name)
VALUES (
    'b1957e2d-6c67-4896-b362-f6d34106081a',
    'john@example.com', 'John', 'Doe'
)
ON CONFLICT (email) DO NOTHING;

-- Card on file for this plan. Default card, so the portal's Payment method
-- panel and the Update card modal both have something to render.
INSERT INTO customer_cards (
    id, customer_id, stripe_payment_method_id,
    last_four, exp_month, exp_year, brand, is_default
) VALUES (
    '63ea68fc-8377-4ede-857a-6a88e9396f14',
    (SELECT id FROM customers WHERE email = 'john@example.com'),
    'pm_demo_009a65b6f58f',
    '4242', 12, 2030, 'visa', TRUE
)
ON CONFLICT (id) DO NOTHING;

-- Booking. Check-in is 2027-03-11, comfortably after the last installment
-- (2026-09-16), which is what makes an in-flight plan legal under the
-- final-payment-before-arrival rule. Check-out is two nights later, matching
-- "Harbor View Room, 2 nights" and the 2 x $425 subtotal. The runtime row had
-- checkout_date 2026-09-13 — six months BEFORE its own check-in — left behind
-- when the check-in date was pushed to 2027 by hand.
INSERT INTO bookings (
    id, merchant_id, booking_token, service_name,
    total_amount_cents, original_total_cents,
    appointment_date, checkout_date,
    status, booking_source, customer_id,
    customer_name_hint, customer_email_hint
) VALUES (
    '52090db1-374a-48a7-ba29-4587f77e49f2',
    (SELECT id FROM merchants WHERE slug = 'hawthorn-camden'),
    'loTd65zNH2wVp2le',
    'Harbor View Room, 2 nights',
    85680,     -- discounted total ($856.80)
    95200,     -- original total ($952.00)
    DATE '2027-03-11',
    DATE '2027-03-13',
    'accepted',
    'customer_initiated',
    (SELECT id FROM customers WHERE email = 'john@example.com'),
    'John Doe',
    'john@example.com'
)
ON CONFLICT (id) DO NOTHING;

-- Plan — active, deposit + 4 monthly installments, 3 of 5 rows settled.
INSERT INTO payment_plans (
    id, booking_id, customer_id, customer_card_id,
    total_amount_cents, num_payments, frequency,
    start_date, end_date, deposit_amount_cents,
    processing_fee_cents, status, payment_rail
) VALUES (
    'be72e70e-4162-4196-9c68-c5ee6e7c3363',
    '52090db1-374a-48a7-ba29-4587f77e49f2',
    (SELECT id FROM customers WHERE email = 'john@example.com'),
    '63ea68fc-8377-4ede-857a-6a88e9396f14',
    85680,
    4,
    'monthly',
    DATE '2026-05-31',
    DATE '2026-09-16',
    8568,
    2000,
    'active',
    'stripe'
)
ON CONFLICT (id) DO NOTHING;

-- Schedule. paid_at sits on the row's own due date (seconds after the attempt),
-- which is the shape a real off-session charge leaves behind.
INSERT INTO payment_schedule (
    id, payment_plan_id, sequence, due_date, amount_cents,
    status, kind, stripe_payment_intent_id, attempted_at, paid_at
) VALUES
    (
        'cbf607c5-e2f4-4246-bcbb-9f9e55fb9d53',
        'be72e70e-4162-4196-9c68-c5ee6e7c3363',
        1, DATE '2026-05-31', 10568,
        'paid', 'deposit', 'pi_demo_cbf607c5e2f4',
        TIMESTAMPTZ '2026-05-31 15:19:03.896246-04',
        TIMESTAMPTZ '2026-05-31 15:19:03.896246-04'
    ),
    (
        'd665eb3a-048b-4128-af70-95dd14b1fd07',
        'be72e70e-4162-4196-9c68-c5ee6e7c3363',
        2, DATE '2026-06-16', 19278,
        'paid', 'installment', 'pi_demo_d665eb3a048b',
        TIMESTAMPTZ '2026-06-16 09:00:00-04',
        TIMESTAMPTZ '2026-06-16 09:00:02-04'
    ),
    (
        '98ce8e91-1cf3-4838-9dea-4697da990813',
        'be72e70e-4162-4196-9c68-c5ee6e7c3363',
        3, DATE '2026-07-16', 19278,
        'paid', 'installment', 'pi_demo_98ce8e911cf3',
        TIMESTAMPTZ '2026-07-16 09:00:00-04',
        TIMESTAMPTZ '2026-07-16 09:00:02-04'
    ),
    (
        'e59a5508-1f5c-45ef-9d0f-b3bd4a17f195',
        'be72e70e-4162-4196-9c68-c5ee6e7c3363',
        4, DATE '2026-08-16', 19278,
        'scheduled', 'installment', NULL, NULL, NULL
    ),
    (
        '7271f76a-3079-4b92-8fb5-cff430c03ad0',
        'be72e70e-4162-4196-9c68-c5ee6e7c3363',
        5, DATE '2026-09-16', 19278,
        'scheduled', 'installment', NULL, NULL, NULL
    )
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Correction pass. ON CONFLICT DO NOTHING cannot repair a row that already
-- exists, and on the machine this plan came from every row had drifted. These
-- restate the target and are a no-op once it holds.
-- ---------------------------------------------------------------------------

UPDATE payment_schedule SET
    due_date = DATE '2026-05-31', status = 'paid', amount_cents = 10568,
    attempted_at = TIMESTAMPTZ '2026-05-31 15:19:03.896246-04',
    paid_at      = TIMESTAMPTZ '2026-05-31 15:19:03.896246-04'
WHERE id = 'cbf607c5-e2f4-4246-bcbb-9f9e55fb9d53'
  AND (due_date, status, amount_cents) IS DISTINCT FROM
      (DATE '2026-05-31', 'paid', 10568);

UPDATE payment_schedule SET
    due_date = DATE '2026-06-16', status = 'paid', amount_cents = 19278,
    attempted_at = TIMESTAMPTZ '2026-06-16 09:00:00-04',
    paid_at      = TIMESTAMPTZ '2026-06-16 09:00:02-04'
WHERE id = 'd665eb3a-048b-4128-af70-95dd14b1fd07'
  AND (due_date, status, amount_cents) IS DISTINCT FROM
      (DATE '2026-06-16', 'paid', 19278);

UPDATE payment_schedule SET
    due_date = DATE '2026-07-16', status = 'paid', amount_cents = 19278,
    attempted_at = TIMESTAMPTZ '2026-07-16 09:00:00-04',
    paid_at      = TIMESTAMPTZ '2026-07-16 09:00:02-04'
WHERE id = '98ce8e91-1cf3-4838-9dea-4697da990813'
  AND (due_date, status, amount_cents) IS DISTINCT FROM
      (DATE '2026-07-16', 'paid', 19278);

UPDATE payment_schedule SET
    due_date = DATE '2026-08-16', status = 'scheduled', amount_cents = 19278,
    stripe_payment_intent_id = NULL, attempted_at = NULL, paid_at = NULL
WHERE id = 'e59a5508-1f5c-45ef-9d0f-b3bd4a17f195'
  AND (due_date, status, amount_cents) IS DISTINCT FROM
      (DATE '2026-08-16', 'scheduled', 19278);

UPDATE payment_schedule SET
    due_date = DATE '2026-09-16', status = 'scheduled', amount_cents = 19278,
    stripe_payment_intent_id = NULL, attempted_at = NULL, paid_at = NULL
WHERE id = '7271f76a-3079-4b92-8fb5-cff430c03ad0'
  AND (due_date, status, amount_cents) IS DISTINCT FROM
      (DATE '2026-09-16', 'scheduled', 19278);

-- Stay dates. Check-out belongs two nights after check-in; the runtime row
-- carried a check-out six months before it.
UPDATE bookings SET
    appointment_date = DATE '2027-03-11',
    checkout_date    = DATE '2027-03-13'
WHERE id = '52090db1-374a-48a7-ba29-4587f77e49f2'
  AND (appointment_date, checkout_date) IS DISTINCT FROM
      (DATE '2027-03-11', DATE '2027-03-13');

-- Plan window follows its own schedule.
UPDATE payment_plans SET
    start_date = DATE '2026-05-31',
    end_date   = DATE '2026-09-16',
    status     = 'active'
WHERE id = 'be72e70e-4162-4196-9c68-c5ee6e7c3363'
  AND (start_date, end_date, status) IS DISTINCT FROM
      (DATE '2026-05-31', DATE '2026-09-16', 'active');

COMMIT;

-- Reset:
--   DELETE FROM payment_schedule WHERE payment_plan_id = 'be72e70e-4162-4196-9c68-c5ee6e7c3363';
--   DELETE FROM payment_plans    WHERE id = 'be72e70e-4162-4196-9c68-c5ee6e7c3363';
--   DELETE FROM bookings         WHERE id = '52090db1-374a-48a7-ba29-4587f77e49f2';
--   DELETE FROM customer_cards   WHERE id = '63ea68fc-8377-4ede-857a-6a88e9396f14';
