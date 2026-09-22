-- Guest-driven referrals: a guest gets a personal link, sends it to a hotel,
-- and earns a credit when that hotel goes live.
--
-- V28 modelled a referral as "a guest told us about a hotel". This adds the
-- referrer: a guest with a durable code and a link of their own. The referrals
-- table grows the attribution columns and two new rungs on its status ladder.
--
-- Additive: one new table, three new columns, one widened CHECK, two columns
-- made nullable. Nothing is backfilled. Existing rows keep referrer_id NULL and
-- their current status, and every V28 code path still works against them.
--
--
-- THE LADDER, after this migration
--
--   submitted -> clicked -> contacted -> demo_booked -> live -> credited
--        \__________\___________\_____________\__________\___-> declined
--
-- Two rungs are new: clicked (the hotel opened the link) and demo_booked (they
-- booked a demo off it). The other four are V28's, unchanged in name and
-- meaning, so no existing row moves and no existing query breaks.
--
-- "paid" from the product brief is NOT a new status. It is `credited`, which
-- already means an admin applied a credit to the guest. One word per state.
--
--
-- clicked_at VS the `clicked` status, which are not the same thing
--
-- clicked_at is the durable record that the hotel opened the link. The status
-- is only a rung, and the ladder is forward-only, so a hotel that clicks again
-- after we have already contacted them cannot move the status back to clicked.
-- That late click still has to be recorded, so it lands on clicked_at while the
-- status stays where it is. Read clicked_at, not the status, to answer "did
-- they ever visit".
--
--
-- WHY hotel_name AND hotel_city BECOME NULLABLE
--
-- V28 required them because a referral was a form submission that named a
-- hotel. A referral can now be created by a click, where all we know is whose
-- code was used. The hotel identifies itself later, when it books a demo or an
-- admin links the merchant. NOT NULL would mean inventing a placeholder name
-- at click time and never being able to tell it from a real one.
--
--
-- WHY referrers CARRIES ITS OWN magic_token, rather than using
-- magic_link_tokens
--
-- That table (V3, scoped by V25) is single-use: hashed, TTL'd, and stamped
-- consumed_at on first use. The guest status page is a bookmark, not a sign-in.
-- It has to keep working on the tenth visit and a month later, which is the
-- opposite of what that table guarantees. Reusing it would mean removing the
-- single-use property for one subject type, weakening it for the two that
-- depend on it.
--
-- The trade is that this token is a bearer secret with no expiry. It is 32
-- bytes of SecureRandom, it is not guessable, and it reveals only which hotels
-- that guest referred and how far along they are. No payment data and no
-- account access hang off it.

CREATE TABLE referrers (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Stored lowercased by the application, as referrals.guest_email is, so the
    -- unique index and the idempotent lookup both work on plain equality.
    email        TEXT NOT NULL UNIQUE,
    -- Six characters from an alphabet with no 0/O/1/I/L/U, so a guest can read
    -- one off a screen and a hotel can retype it without a support ticket.
    code         TEXT NOT NULL UNIQUE CHECK (code ~ '^[2-9A-HJ-NP-TV-Z]{6}$'),
    -- Bearer token for the guest's status page. See the note above.
    magic_token  TEXT NOT NULL UNIQUE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The status page and the start endpoint both look a referrer up by token.
CREATE INDEX referrers_magic_token_idx ON referrers (magic_token);

ALTER TABLE referrals
    ADD COLUMN referrer_id UUID NULL REFERENCES referrers(id),
    -- The code as it stood when this referral was attributed. Redundant with
    -- referrer_id today, because codes never change. Kept as a snapshot so the
    -- row still says which code earned it if that ever stops being true.
    ADD COLUMN code        TEXT NULL,
    ADD COLUMN clicked_at  TIMESTAMPTZ NULL;

-- Attribution lookups: "has this code already got a referral open" on click,
-- and "list everything this guest referred" on the status page.
CREATE INDEX referrals_referrer_id_idx ON referrals (referrer_id);

-- A click creates a referral before the hotel is known.
ALTER TABLE referrals ALTER COLUMN hotel_name DROP NOT NULL;
ALTER TABLE referrals ALTER COLUMN hotel_city DROP NOT NULL;

-- Widen the ladder. The old constraint named four states plus declined; this
-- names six plus declined. Dropping and re-adding is the only way to change a
-- CHECK, and it is safe here because every existing value is still legal.
ALTER TABLE referrals DROP CONSTRAINT referrals_status_check;
ALTER TABLE referrals
    ADD CONSTRAINT referrals_status_check
        CHECK (status IN ('submitted', 'clicked', 'contacted', 'demo_booked',
                          'live', 'credited', 'declined'));

-- At most one UNIDENTIFIED open referral per referrer. This is the database
-- half of first-click-wins: a second click on the same link finds the existing
-- row rather than opening a second one.
--
-- Scoped to hotel_name IS NULL on purpose. A click knows the code but not who
-- clicked, so those rows are interchangeable and a second one would be a
-- duplicate. A referral where the guest named the hotel is a distinct thing and
-- a guest may name as many as they like, so those are not constrained. The
-- terminal states are excluded so a code can be used again once its last
-- referral has settled.
CREATE UNIQUE INDEX referrals_one_unidentified_per_referrer_idx
    ON referrals (referrer_id)
    WHERE referrer_id IS NOT NULL
      AND hotel_name IS NULL
      AND status NOT IN ('credited', 'declined');
