-- Default a new property to no PMS rail instead of the Stripe rail.
--
-- Background. V17 gave merchants.pms_type a DEFAULT of 'stripe'. That made
-- every new signup a Stripe-rail property before it had chosen anything. The
-- onboarding funnel does not offer Stripe (the PMS step lists Mews and
-- Cloudbeds only) and the payment-processor connect step has now been removed
-- from the funnel entirely, while PropertyOnboardingService still required a
-- charges-enabled Connect account to move a Stripe-rail property to
-- 'pms_connected'. A property that signed up and stopped before picking a PMS
-- was therefore parked on a rail with no reachable completion path.
--
-- 'none' is the honest value for that state: it means "has not chosen", and the
-- only way out of it is the PMS step, which is where such a property belongs.

ALTER TABLE merchants
    ALTER COLUMN pms_type SET DEFAULT 'none';

-- The CHECK from V17 has to be replaced rather than extended; Postgres has no
-- ALTER CONSTRAINT for a CHECK expression.
ALTER TABLE merchants
    DROP CONSTRAINT merchants_pms_type_chk;
ALTER TABLE merchants
    ADD CONSTRAINT merchants_pms_type_chk
        CHECK (pms_type IN ('none', 'stripe', 'mews', 'cloudbeds'));

-- Un-strand existing properties that are sitting on the Stripe rail without
-- having completed it. These are rows that took the old default and stopped:
-- with the connect step gone they could never reach 'pms_connected', so they
-- are moved back to 'none' and will be sent through the PMS step.
--
-- Deliberately scoped to the two pre-connection states. A Stripe-rail property
-- at 'pms_connected', 'policy_set' or 'active' finished the flow while it still
-- existed and keeps working unchanged on the platform charge path — this is
-- what protects the seeded Marbrook Lodge demo (pms_type 'stripe',
-- onboarding_state 'active', charges_enabled), which is a deliberate no-PMS
-- property and not a stranded one.
--
-- Idempotent: once run, no row matches.
UPDATE merchants
   SET pms_type = 'none'
 WHERE pms_type = 'stripe'
   AND onboarding_state IN ('created', 'pms_selected');
