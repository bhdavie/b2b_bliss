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
  // Unified Marbrook merchant: the funnel and the merchant dashboard now resolve
  // to the same account (dev-login is find-or-create by email). The retired test
  // copy was frontdesk@marbrookhouse.test.
  email: "demo@marbrookhouse.com",
  businessName: "Marbrook House",
  businessType: "hotel",
  addressLine1: "118 Greenwich Avenue",
  addressCity: "Hudson",
  addressState: "NY",
  addressZip: "12534",
  tagline: "Boutique riverside hotel · Hudson Valley, NY",
} as const;
