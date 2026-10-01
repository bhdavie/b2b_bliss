-- The property's Mews pricing mode, from configuration/get: Gross (prices
-- include tax) or Net (tax is added on top). Amounts Bliss posts to the folio
-- are sent as the matching value; Mews refuses a taxed gross value on a net
-- pricing property. Null until the next connect or sync reads it.
ALTER TABLE merchant_mews_connections
    ADD COLUMN pricing VARCHAR(16);

ALTER TABLE merchant_mews_connections
    ADD CONSTRAINT merchant_mews_connections_pricing_chk
        CHECK (pricing IS NULL OR pricing IN ('Gross', 'Net'));
