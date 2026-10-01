-- The Mews reservation number a hotel recognises (the id is Mews's internal
-- one), recorded at link time from now on. Existing linked bookings carry it
-- in their service description, "Mews reservation 134557", so it is copied
-- from there.
ALTER TABLE bookings ADD COLUMN mews_reservation_number VARCHAR(32);

UPDATE bookings
SET mews_reservation_number = substring(service_description FROM '^Mews reservation ([0-9]+)$')
WHERE mews_reservation_id IS NOT NULL
  AND service_description ~ '^Mews reservation [0-9]+$';

-- Properties that finished onboarding before Bliss had a switch are switched
-- on quietly: settings rows with defaults, enabled now, and their "Bliss is on"
-- email marked as sent so it never goes.
INSERT INTO property_bliss_settings (merchant_id)
SELECT id FROM merchants WHERE onboarding_state = 'active'
ON CONFLICT (merchant_id) DO NOTHING;

UPDATE property_bliss_settings s
SET bliss_enabled_at = NOW()
FROM merchants m
WHERE m.id = s.merchant_id
  AND m.onboarding_state = 'active'
  AND s.bliss_enabled_at IS NULL;

INSERT INTO email_log (dedupe_key, email_type, recipient)
SELECT 'bliss_on:' || id, 'bliss_on', email FROM merchants WHERE onboarding_state = 'active'
ON CONFLICT (dedupe_key) DO NOTHING;
