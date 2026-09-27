-- What the Bliss pop-up tells a guest the rate charges upfront, per Bliss rate.
--
-- Display only. The deposit a plan is built on is always the charge Mews
-- actually took at booking (MewsLinkService); these exist because the rate's
-- payment policy lives in Mews and cannot be read back through the Connector
-- API, so the pop-up would otherwise preview every plan with no deposit.
-- Basis points (2000 = 20%). Null means "not set": the pop-up shows no deposit.
ALTER TABLE merchant_mews_connections
    ADD COLUMN bliss_monthly_deposit_bps  INTEGER,
    ADD COLUMN bliss_biweekly_deposit_bps INTEGER;

ALTER TABLE merchant_mews_connections
    ADD CONSTRAINT merchant_mews_connections_deposit_bps_chk CHECK (
        (bliss_monthly_deposit_bps IS NULL OR bliss_monthly_deposit_bps BETWEEN 0 AND 10000)
        AND (bliss_biweekly_deposit_bps IS NULL OR bliss_biweekly_deposit_bps BETWEEN 0 AND 10000));
