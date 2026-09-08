// Curated identity for the simulated Mews Marketplace install. The Bliss
// merchant provisioned by the install flow uses these details. The email is
// deterministic so re-running the install reuses the same demo merchant
// (dev-login is find-or-create) rather than piling up rows.
//
// Note: this is the *displayed* brand. The flow also makes a live Mews
// configuration/get call (see fetchMewsConnection) to prove the .env
// credentials resolve to a real property, but the real enterprise name in the
// demo dataset is a test string, so it isn't shown as the brand.

export const DEMO_HOTEL = {
  // The PUBLIC demo account, deliberately NOT a Marbrook address. dev-login is
  // held open for this one email in production (BLISS_DEMO_LOGIN_EMAILS) so the
  // live funnels can sign anyone in here, while the real Marbrook portal is a
  // separate account that only the master password opens. The retired test copy
  // was frontdesk@marbrookhouse.test.
  email: "demo@bliss-payments.com",
  // Stable slug for the unified demo merchant, so the funnel can read its saved
  // policies via the public merchants endpoint without a merchant-session call.
  slug: "j9l29fke",
  businessName: "Marbrook House",
  businessType: "hotel",
  addressLine1: "118 Greenwich Avenue",
  addressCity: "Hudson",
  addressState: "NY",
  addressZip: "12534",
  tagline: "Boutique riverside hotel · Hudson Valley, NY",
} as const;

// Frozen constant for the preserved /inn/marbrook-classic demo — do not change it when DEMO_HOTEL changes.
export const DEMO_HOTEL_CLASSIC = {
  // Same public demo account as DEMO_HOTEL - see the note there on why this is
  // not a Marbrook address.
  email: "demo@bliss-payments.com",
  slug: "j9l29fke",
  businessName: "Marbrook House",
  businessType: "hotel",
  addressLine1: "118 Greenwich Avenue",
  addressCity: "Hudson",
  addressState: "NY",
  addressZip: "12534",
  tagline: "Boutique riverside hotel · Hudson Valley, NY",
} as const;
