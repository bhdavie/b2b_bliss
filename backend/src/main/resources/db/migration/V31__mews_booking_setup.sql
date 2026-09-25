-- Real Mews bookings: Bliss creates the reservation itself.
--
-- Additive only. Nothing existing changes shape.
--
-- merchant_mews_connections gains the property's booking setup, chosen once in
-- the dashboard from the property's own Mews catalogue:
--   service_id             the bookable (stay) service reservations go on
--   bliss_rate_id          the rate Bliss books. The hotel keeps this rate
--                          private with no payment policy, so Mews never
--                          charges or requests a prepayment on top of the plan
--   adult_age_category_id  PersonCounts on reservations/add need it
--   time_zone              the enterprise time zone; check-in and check-out
--                          dates become StartUtc/EndUtc through it
-- All nullable: a property is connected before it finishes this setup, and
-- checkout refuses a Mews booking until it has.
ALTER TABLE merchant_mews_connections
    ADD COLUMN service_id            VARCHAR(64),
    ADD COLUMN bliss_rate_id         VARCHAR(64),
    ADD COLUMN adult_age_category_id VARCHAR(64),
    ADD COLUMN time_zone             VARCHAR(64);

-- bookings gains what the reservation was made from, and the reservation id
-- once it exists. mews_reservation_id is what every installment charge passes
-- as ReservationId, and what cancellation cancels. It is unique so one Mews
-- reservation can never back two bookings.
ALTER TABLE bookings
    ADD COLUMN mews_reservation_id       VARCHAR(64),
    ADD COLUMN mews_resource_category_id VARCHAR(64),
    ADD COLUMN mews_rate_id              VARCHAR(64),
    ADD COLUMN adult_count               INTEGER;

ALTER TABLE bookings
    ADD CONSTRAINT bookings_adult_count_chk CHECK (adult_count IS NULL OR adult_count > 0);

CREATE UNIQUE INDEX bookings_mews_reservation_id_idx
    ON bookings (mews_reservation_id)
    WHERE mews_reservation_id IS NOT NULL;
