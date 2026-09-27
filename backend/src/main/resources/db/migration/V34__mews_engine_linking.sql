-- Mews bookings made in the property's own booking engine.
--
-- The guest books a Bliss rate in the Mews booking engine. Mews takes the card
-- and whatever the rate charges upfront; Bliss finds the reservation by polling
-- and builds the plan for the remainder. Additive only.
--
-- merchant_mews_connections gains the property's Bliss rates, one per payment
-- schedule. The rate a reservation is on is how Bliss knows both that the
-- booking is a Bliss plan and which schedule the guest chose. Either may be
-- null: a property can offer one schedule only. linked_through_utc is the
-- polling high-water mark: reservations updated at or before it were seen.
ALTER TABLE merchant_mews_connections
    ADD COLUMN bliss_monthly_rate_id  VARCHAR(64),
    ADD COLUMN bliss_biweekly_rate_id VARCHAR(64),
    ADD COLUMN linked_through_utc     TIMESTAMPTZ;

-- The stay as Mews had it when the plan was linked, so a later change of dates
-- in Mews is noticed and flagged to the property instead of silently charging
-- a schedule built for other dates.
ALTER TABLE bookings
    ADD COLUMN mews_start_utc TIMESTAMPTZ,
    ADD COLUMN mews_end_utc   TIMESTAMPTZ;

-- One row per Bliss-rate reservation Bliss has seen. A reservation is seen
-- before Mews has necessarily recorded the upfront charge, so linking can take
-- more than one pass; this row carries it between passes. 'linked' rows point
-- at the booking the plan was built on. 'flagged' rows need a person: the
-- reason is in the matching mews_flags row.
CREATE TABLE mews_reservation_links (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id     UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    reservation_id  VARCHAR(64) NOT NULL,
    status          VARCHAR(16) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'linked', 'flagged')),
    booking_id      UUID REFERENCES bookings(id),
    attempts        INTEGER NOT NULL DEFAULT 0,
    last_error      TEXT,
    first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_attempt_at TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX mews_reservation_links_reservation_idx
    ON mews_reservation_links (merchant_id, reservation_id);
CREATE INDEX mews_reservation_links_pending_idx
    ON mews_reservation_links (merchant_id) WHERE status = 'pending';

CREATE TRIGGER mews_reservation_links_set_updated_at
    BEFORE UPDATE ON mews_reservation_links
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Something about a Bliss reservation that Bliss will not decide on its own:
-- dates changed in Mews, cancelled in Mews, no upfront charge to link a card
-- from, not eligible for a plan. The property is emailed once per flag
-- (notified_at) and resolves it by hand (resolved_at). One flag per kind per
-- reservation, so a repeating pass cannot email the property twice.
CREATE TABLE mews_flags (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id     UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    reservation_id  VARCHAR(64) NOT NULL,
    booking_id      UUID REFERENCES bookings(id),
    kind            VARCHAR(32) NOT NULL
                    CHECK (kind IN ('dates_changed', 'canceled_in_mews', 'no_upfront_charge',
                                    'not_eligible', 'link_failed')),
    detail          TEXT NOT NULL,
    notified_at     TIMESTAMPTZ,
    resolved_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX mews_flags_reservation_kind_idx
    ON mews_flags (merchant_id, reservation_id, kind);
CREATE INDEX mews_flags_open_idx
    ON mews_flags (merchant_id) WHERE resolved_at IS NULL;
