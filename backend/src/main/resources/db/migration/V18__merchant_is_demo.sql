-- Demo account flag for the dev-only reset kill switch.
--
-- Additive: one new column, defaulting false. Every existing property (including
-- the seeded Marbrook and Hawthorn demo properties) becomes is_demo=false, so
-- the reset endpoint never touches them unless they are explicitly flagged.
--
-- New signups are flagged is_demo=true at insert time while BLISS_DEMO_LOGIN is
-- on (see MagicLinkService); the column default only covers rows created before
-- this feature and any non-demo path.

ALTER TABLE merchants
    ADD COLUMN is_demo BOOLEAN NOT NULL DEFAULT false;
