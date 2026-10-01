-- Optional guest allowlist on a Mews connection.
--
-- NULL (every real property): the link pass links any Bliss-rate reservation,
-- as before. Set (a demo property on a shared Mews sandbox): it links only
-- reservations whose guest email is on the list, and ignores every other
-- reservation before recording anything, so nobody else's sandbox booking can
-- become a plan or be charged. Each entry is either a full email address or a
-- plus tag such as "+bliss-e2e", which matches any address whose local part
-- contains it. Matching is case-insensitive. An empty list links nobody.
ALTER TABLE merchant_mews_connections
    ADD COLUMN link_guest_allowlist TEXT[];
