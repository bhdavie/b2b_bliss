-- Initial migration. Schema entities are added in subsequent phases:
--   V2 merchants            (Phase 1)
--   V3 bookings              (Phase 3)
--   V4 customers, customer_cards (Phase 4)
--   V5 payment_plans, payment_schedule (Phase 4)
--   V6 payouts               (Phase 6)
--   V7 webhook_events, merchant_webhook_endpoints (Phase 7)
--
-- Kept intentionally empty so Flyway has a baseline to track.
SELECT 1;
