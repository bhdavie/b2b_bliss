-- Guest referrals: a guest tells us about a hotel they want on Bliss.
--
-- One row per submission, tracked by an admin through to the hotel going live
-- and, later, a credit on that guest's plan. The status ladder is
--
--   submitted -> contacted -> live -> credited
--
-- with declined reachable from anywhere short of credited, and credited final.
-- The forward-only rule lives in
-- ReferralStatus, not in the database: a CHECK can say which values exist but
-- not which order they may be written in, and a trigger for it would be a
-- second copy of the rule to keep in step.
--
-- Additive only. One new table, nothing existing is altered.
--
-- Deliberately NOT here:
--
--   The credit itself. "credited" records that an admin applied one; it does
--   not hold an amount and nothing reads it on the charge path. How a credit
--   reaches a plan (customers.credit_balance_cents from V8 has no readers or
--   writers today) is a separate decision with its own migration.
--
--   A customer_id. The submitter may not have a Bliss account yet, so the
--   guest is identified by email alone and matched to a customer when the
--   credit is applied.
--
-- merchant_id is set by an admin when the hotel is on Bliss. It is nullable
-- because most referrals start before the property exists. No ON DELETE rule:
-- only non-demo merchants can be linked (enforced in AdminReferralsResource),
-- and the demo reset is the only path that deletes merchants.
--
-- guest_email is stored lowercased by the application, so the duplicate check
-- and the email index both work on a plain equality.
--
-- source_ip is the caller as the public endpoint saw it: the last
-- X-Forwarded-For value (the one the Heroku router appends), else the socket
-- address. Kept for triage and rate limiting, not as an identity.

CREATE TABLE referrals (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    guest_email  TEXT NOT NULL,
    guest_name   TEXT NULL,
    hotel_name   TEXT NOT NULL,
    hotel_city   TEXT NOT NULL,
    note         TEXT NULL,
    status       TEXT NOT NULL DEFAULT 'submitted'
                 CHECK (status IN ('submitted', 'contacted', 'live', 'credited', 'declined')),
    merchant_id  UUID NULL REFERENCES merchants(id),
    source       TEXT NOT NULL DEFAULT 'website',
    source_ip    TEXT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Serves the duplicate check (same email and hotel within 30 days) as well as
-- looking a guest's referrals up at credit time.
CREATE INDEX referrals_guest_email_idx ON referrals (guest_email);
-- The admin queue filters by status.
CREATE INDEX referrals_status_idx ON referrals (status);
CREATE INDEX referrals_merchant_id_idx ON referrals (merchant_id);

CREATE TRIGGER referrals_set_updated_at
    BEFORE UPDATE ON referrals
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
