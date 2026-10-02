-- Whether the property gets the Monday summary email. On by default.
ALTER TABLE property_bliss_settings
    ADD COLUMN weekly_summary BOOLEAN NOT NULL DEFAULT TRUE;

-- Off for the demo properties in production (Marbrook House x2, Marbrook
-- Lodge, Marbrook Grand), whose inboxes are ours. A no-op anywhere these slugs
-- don't exist.
UPDATE property_bliss_settings s
SET weekly_summary = FALSE
FROM merchants m
WHERE m.id = s.merchant_id
  AND m.slug IN ('j9l29fke', 'k2npx8vt', 'l4vt8zpc', 'g7hq2wxn');
