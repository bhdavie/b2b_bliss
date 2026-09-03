/* eslint-disable */
/**
 * ===========================================================================
 * CONSOLE PASTE ONLY. LOCAL DEMO. NOT SHIPPED.
 *
 * Paste this whole file into the browser console on a Detroit Foundation Hotel
 * Olive booking engine page. It is not hosted, not bundled, not referenced by
 * any build, and nothing in the app imports it. It exists so a Bliss payment
 * plan teaser can be shown on a real third-party booking engine during a demo.
 *
 * Do not link it from a page and do not treat it as a supported integration.
 * ===========================================================================
 *
 * The third member of the family, after frontend/public/mews-overlay.js (the
 * original, still authoritative) and frontend/public/ayres-overlay.js.
 *
 * THREE SURFACES. This file renders on all of them, which is one more than
 * either sibling covers:
 *
 *   1. ROOM DETAIL PAGE RATE CARDS. The per-rate cards on a single room's
 *      page, which render "$344 $303 / night" inside the price block.
 *   2. THE MULTI-ROOM RESULTS LIST. The same teaser on the cards in the list
 *      of all available rooms. This surface renders NO per-night wording
 *      anywhere near a price, which is what CONFIG.rateCards.requirePerNight
 *      = "auto" exists to handle — see DISCOVERY.
 *   3. THE CHECKOUT STEP TRIP SUMMARY. A block after the "Total" row of the
 *      Trip Summary card on the /booking/ route.
 *
 * Surfaces 1 and 2 are one code path (trigger kind "rate-card") because they
 * are the same card shape found the same way; the checkout step is the other
 * (trigger kind "details"). Everything downstream of the amount — the teaser
 * markup, the modal, the copy — is one shared renderer for all three.
 *
 * WHAT IS THE SAME as the siblings, deliberately and byte-for-byte where
 * possible:
 *   - the eligibility / installment math
 *   - the shadow-root rendering model
 *   - the teaser markup and every copy string
 *   - the modal, its states, and all of its CSS
 *   - the Bliss amethyst palette and typography rules
 *   - the observer / re-render recovery model
 *
 * WHAT CHANGED, and only this:
 *   1. NO NETWORK. Both siblings fetch merchant plan rules at boot. This one
 *      does not: the demo brief for it is explicitly "no backend calls, no
 *      network requests, no data leaving the page". It runs on DEFAULT_RULES
 *      and the install report says so. See the NO NETWORK note below.
 *   2. Stay dates come from the URL HASH on the rate-card surfaces. Olive is a
 *      hash router, so the query params live after the first "?" inside
 *      location.hash, not in location.search. Both are read; whichever yields
 *      a startDate wins. The checkout block does NOT share that read: its
 *      dates come from the Trip Summary card's own date range, because on the
 *      booking route the hash carries a cart id and no stay.
 *   3. DISCOVERY IS DOM-FIRST, DATALAYER-SECOND. This is the inversion, and it
 *      is the important difference from mews-overlay.js. See DISCOVERY below.
 *   4. Rate-card amounts come from the dataLayer, not from a scrape, so the
 *      teaser and the modal share ONE basis. The known issue both siblings
 *      carry — the teaser and the modal quoting different bases within a
 *      surface — does not exist here, on any of the three. See BASIS.
 *   5. The Bliss fee is ONE config value applied through ONE function, so it
 *      reaches the rate-card basis and the checkout basis identically. On this
 *      property it is zero: Detroit Foundation is on a free plan, so nothing
 *      is added to the guest's total on either surface. See BLISS FEE.
 *
 * ---------------------------------------------------------------------------
 * DISCOVERY — cards first, dataLayer second
 *
 * mews-overlay.js walks the dataLayer's rate array and hunts for a card per
 * rate. That is the wrong way round on Olive, and measurably so: the dataLayer
 * carries rates for EVERY room in the property while the room detail page
 * renders only the room being viewed. Walking the data first against 8 items
 * and 2 rendered cards produced 2 anchored teasers plus 6 that matched nothing.
 *
 * So this file walks the DOM: find the rate cards that are actually on screen,
 * then find the dataLayer item for each one. A card with no matching item is
 * SKIPPED SILENTLY and counted. Nothing is ever injected that is not inside a
 * rate card or the Trip Summary card — there is no floating fallback panel,
 * deliberately, because a panel floating over a customer's own booking page
 * during their own demo is worse than showing nothing.
 *
 * Cards are found structurally, never by class. Olive is CSS-modules and its
 * class names are build hashes (price__CYdhm, price-value__PFyjN,
 * comparison-price__AaBG1) that change on every Olive deploy. The durable
 * signature of a rate card is: it contains a money-shaped string, it contains
 * exactly one booking CTA, and its parent contains more than one. That last
 * clause is the cardinality stop, and it is what keeps the climb from settling
 * on the list container and collapsing every rate into one card — the same
 * failure ayres-overlay.js documents at resolveCard. It is also what makes the
 * multi-room results list work on the same code path as the detail page.
 *
 * The per-night marker is required STRICTLY FIRST and relaxed only if the
 * strict pass finds no cards anywhere on the page, because the results list
 * carries no such marker at any ancestor of any money leaf. The fallback is
 * PAGE-SCOPED, not per-card, so one page cannot mix a strict card and a
 * relaxed one and let a fee row in beside a real rate.
 *
 * The checkout step is found by TEXT for the same reason: the Total label as
 * its own element, anchored on exactly "Total" and never on a prefix, inside a
 * card carrying both a "Nightly Rate" and a "Taxes and Fees" marker. Either
 * marker alone appears in plenty of places; the pair does not.
 *
 * ---------------------------------------------------------------------------
 * BASIS
 *
 * Within any one surface the teaser and the modal reconcile exactly, which is
 * the sibling known issue this file does not have. Across surfaces they do not
 * and cannot: a rate card plans against the pre-tax nightly figure, while the
 * checkout block plans against the tax-inclusive Total over the night count.
 * That is why supportingLine drops the "Pre-tax" qualifier on the checkout
 * block and why basisLine switches its fine print there. Same split both
 * siblings carry between their two surfaces.
 *
 * Whether Olive's rate-card price is tax-exclusive is UNKNOWN, and
 * CONFIG.rateCards.priceIsTaxExclusive is null rather than false to say so.
 * Until someone checks an Olive booking through to a tax line, the rate-card
 * teaser claims no tax basis at all.
 *
 * ---------------------------------------------------------------------------
 * LIVE, NOT FROZEN
 *
 * Every figure is recomputed on every sync and nothing is cached across one.
 * sync() is driven by four independent things, because no single one of them
 * catches every change on a hash-routed SPA:
 *
 *   - a MutationObserver on document.body (the room list re-renders in place)
 *   - hashchange and popstate (Olive routes and carries its dates in the hash)
 *   - a dataLayer.push hook (Olive re-pushes view_item_list on a date change,
 *     sometimes without a route change; ported from mews-overlay.js)
 *   - a debounced resize (ported from ayres-overlay.js, where closing DevTools
 *     resized the viewport, re-rendered the host and stranded the overlay)
 *
 * An open modal re-renders from the same sync, so changing dates behind a modal
 * updates the schedule in place rather than leaving a stale one on screen.
 *
 * ---------------------------------------------------------------------------
 * PLAN MATH PROVENANCE
 *
 * The eligibility section is a verbatim port of frontend/lib/eligibility.ts,
 * which mirrors backend PlanEligibilityService.java, and is identical to the
 * same section in both siblings. Function names, ordering and constants are
 * preserved so the three files stay diffable. Do not "improve" the math here.
 *
 * Monthly means CALENDAR monthly: installments collect on a fixed anchor day
 * (the 2nd or the 16th, chosen by booking day), with payment 2 pushed to the
 * next anchor when the first falls inside MONTHLY_FIRST_INSTALLMENT_MIN_GAP_DAYS.
 *
 * ---------------------------------------------------------------------------
 * NO NETWORK
 *
 * mews-overlay.js refuses to render without fetched rules, because wrong rules
 * put wrong money on a live booking page. ayres-overlay.js fetches and falls
 * back. This file does neither: it never calls out at all, because the brief
 * for this demo forbids it. That means the rules below are the ONLY rules, and
 * they are the repo defaults rather than a real merchant's terms. The install
 * report states this every time so it cannot be mistaken for live terms.
 * ---------------------------------------------------------------------------
 */
(function () {
  "use strict";

  // =========================================================================
  // BLISS FEE
  //
  // ZERO ON THIS PROPERTY, and that is a merchant fact rather than a stub:
  // Detroit Foundation is on a free plan, so Bliss charges the guest nothing
  // on top and the plan is written against the property's own total. The
  // repo's other fee sources
  //   backend   PlanCreationService.BLISS_FEE_RATE      = 0.05
  //   frontend  frontend/lib/blissFee.ts BLISS_FEE_RATE = 0.05
  // are the PAID-plan rate and are deliberately not mirrored here.
  //
  // ONE VALUE, ONE APPLICATION POINT. The rate lives on CONFIG.blissFeeRate
  // and is applied only by withFee(), which every basis on both surfaces goes
  // through: the rate cards' nightly figure and stay total, and the checkout
  // block's tax-inclusive Total. Raising it for a paid-plan demo is therefore
  // a one-value edit that moves both surfaces together.
  //
  // THAT REPLACED A SPLIT THAT COULD NOT BE SET CONSISTENTLY. The rate cards
  // used to be gated by CONFIG.rateCards.applyFeeToBasis while
  // applyDetailsAmount and summaryPerNightCents applied the rate directly and
  // read no flag, so clearing the flag left the fee on the checkout surface
  // and zeroing the rate left the flag claiming a fee in the fine print.
  //
  // When non-zero the fee is applied ON TOP of the basis: the guest pays it
  // and the hotel is paid net, matching PlanCreationService.feeFor +
  // buildSchedule. Because it lands on the nightly figure and the stay total
  // alike, the teaser and the modal reconcile at any rate, zero included —
  // see fromLine.
  // =========================================================================

  // =========================================================================
  // PLAN RULES
  //
  // The ONLY rules, because this file makes no network call. Values match
  // frontend/lib/api.ts DEFAULT_PLAN_RULES for the 13 fields previewEligibility
  // actually consults. Override before pasting with
  // window.__blissOverlayConfig = { rules: {...} } if a specific merchant's
  // terms need demoing.
  // =========================================================================
  var DEFAULT_RULES = {
    minLeadTimeWeeks: 6,
    maxLeadTimeWeeks: null,
    allowedFrequencies: "both",
    minBookingAmountCents: null,
    maxBookingAmountCents: null,
    recommendedFrequency: null,
    depositRequired: false,
    depositType: null,
    depositValue: null,
    depositMaxCents: null,
    paymentDuePolicy: "at_appointment",
    paymentDueCustomMonths: null,
    discountBasisPoints: 0,
  };

  // =========================================================================
  // PALETTE
  //
  // The current Bliss palette, ported verbatim from mews-overlay.js, which is
  // the source of truth. Every colour in triggerCss and modalCss reads from
  // here, so a palette change is an edit to this object and nothing else.
  //
  // Keys are the palette's own names rather than role names, so a value change
  // here cannot leave a token called "lavender" holding something that is not
  // lavender. What each one is used for is noted alongside it.
  //
  // Deliberately NOT the sampled host accent: the overlay is Bliss speaking
  // inside the property's page, so it should read as ours rather than as
  // another of the host's controls. Only the host FONT is still sampled, which
  // is what keeps both surfaces sitting in the page's typography without
  // borrowing its colour. See sampleHostTheme.
  // =========================================================================
  var BLISS_COLORS = {
    // Accent: primary action, selected option border, focus ring, tick, wordmark.
    amethyst: "#8B5CF6",
    // Primary action, hover only.
    amethystHover: "#7C4DEF",
    tint40: "#D6C8FB",
    // Selected option fill, and the RECOMMENDED chip fill.
    wash: "#F3EEFE",
    // Modal surface, and the unselected option fill.
    bone: "#FDFCFB",
    // Inset and secondary surfaces: the schedule box.
    sunken: "#F6F4F1",
    // Dividers, the header underline, and inactive borders.
    hairline: "#E9E5E1",
    // Primary text: headings, plan names, amounts.
    ink: "#17131C",
    // Secondary text (never a border; see hairline).
    muted: "#6E6878",
    // The label on the primary action, and the tick glyph on amethyst.
    white: "#FFFFFF",
  };

  // =========================================================================
  // CONFIG
  // =========================================================================
  var CONFIG = {
    /** Plan rules. Never null: there is no fetch to be waiting on. */
    rules: null,

    /** Where the rules came from, for the install report. */
    rulesSource: null,

    /**
     * The Bliss fee rate, as a fraction of the basis. See the BLISS FEE note:
     * ZERO here because this property is on a free plan, and the ONE value
     * both surfaces read. Applied only by withFee(); nothing else multiplies
     * by it, so there is no second path that can disagree with this number.
     */
    blissFeeRate: 0,

    /**
     * Stay dates, read from the URL.
     *
     * OLIVE IS A HASH ROUTER. The live rooms URL is
     *   /rooms/#/detroit-foundation/K1D/?adults=2&endDate=2027-01-24&startDate=2027-01-22
     * so the params are after the first "?" INSIDE location.hash, and
     * location.search is empty. Other Olive surfaces put them on the real query
     * string, so both are read and whichever yields a startDate wins.
     *
     * The dates are the durable input here, unlike on Ayres where the URL goes
     * stale against the picker: Olive rewrites the hash on every date change,
     * and hashchange is one of the four things that drives sync.
     */
    stay: {
      checkinParams: ["startDate", "checkin", "datein", "arrive"],
      checkoutParams: ["endDate", "checkout", "dateout", "depart"],
      /** Print the parsed stay on every read rather than only on a change. */
      logEveryRead: false,
    },

    // -----------------------------------------------------------------------
    // RATE CARDS — structural discovery, then matched to a dataLayer item.
    //
    // No class names anywhere. Olive is CSS-modules and every class on the page
    // is a build hash (price__CYdhm, price-value__PFyjN, comparison-price__AaBG1)
    // that changes on every Olive deploy.
    // -----------------------------------------------------------------------
    rateCards: {
      /**
       * A money-shaped string. Requires a currency symbol OR two decimals, so a
       * bare room number or a guest count cannot pass for a price.
       */
      amountRe: /[$£€¥₹]\s*\d[\d,]*(?:\.\d{2})?|\d[\d,]*\.\d{2}/,

      /**
       * What counts as a booking CTA. The cardinality stop counts these: a rate
       * card has one, the list containing every card has several, and that
       * difference is the card boundary.
       */
      ctaSelector: 'button, [role="button"], a[href]',

      /*
       * There is deliberately no maxCtasPerCard here any more. It was the card
       * boundary and it was wrong: see resolveCard. The boundary is repetition,
       * which has no threshold to tune.
       */

      /** Hard ceiling on the card boundary climb. Backstop, not the real stop. */
      cardClimbMax: 14,

      /**
       * THE PER-NIGHT MARKER. A rate card quotes a price PER NIGHT; a parking
       * fee, a resort fee or an add-on quotes a flat amount. Requiring the
       * marker alongside the money is what separates "$303/ night" from "+$40".
       *
       * The live page renders it with a space after the slash ("$303/ night"),
       * so the slash and the word are matched independently of the spacing.
       */
      perNightRe: /\/\s*night|per\s+night|\bnightly\b|\bavg\.?\s*per\s*night\b/i,

      /**
       * The card's rate-conditions line. Two jobs, deliberately one regex:
       * it is the third leg of the card test below, and it is where the teaser
       * is inserted so it carries that line's weight (point 5 of the brief).
       *
       * Broadened from the original non-refundable/cancellation pair after the
       * live page turned out to say "non-changeable" as well. A card whose
       * conditions are worded differently again still gets a teaser — see the
       * two-of-three pass in resolveCard — it just loses the preferred
       * insertion point.
       */
      conditionsRe:
        /non-?refundable|non-?changeable|not\s+refundable|no\s+refund|refundable|cancellation|cancel(?:l?ed|l?able)?|pre-?pay(?:ment)?|prepaid/i,

      /**
       * Longest text a candidate card may carry. A backstop on the climb: past
       * this, the node is a page section rather than a card.
       */
      maxCardTextLength: 2200,

      /**
       * How far above a price the per-night marker may sit before the price is
       * judged not to be a rate at all. Small on purpose: on a rate card the
       * marker is beside the number, and a large number starts matching the
       * page rather than the card.
       */
      perNightClimbMax: 4,

      /**
       * IS A PER-NIGHT MARKER REQUIRED TO CALL A PRICE A RATE?
       *
       *   "auto"  strict first; if the strict pass finds NO cards anywhere on
       *           the page, retry with the requirement relaxed and say so.
       *   true    always require it (the original behaviour).
       *   false   never require it.
       *
       * "auto" exists because the three Olive surfaces do not agree. The room
       * detail page renders "$344 $303 / night" inside the price block, so the
       * marker is right there. The multi-room results list renders no per-night
       * wording anywhere near a price — measured on the live page, the marker
       * count is 0 at every one of the five ancestors above every money leaf —
       * so every price failed the gate and no card was ever considered.
       *
       * The fallback is PAGE-SCOPED, not per-card, so one page cannot mix a
       * strict card and a relaxed one and let a fee row in beside a real rate.
       */
      requirePerNight: "auto",

      /**
       * Rates whose name matches this regex get no teaser. Same lever and same
       * caveat as both siblings: matching on a name is a workaround, not a
       * pay-now signal. Nothing in Olive's dataLayer exposes payment timing at
       * rate-selection time either.
       * @type {RegExp|null}
       */
      excludeRatePattern: null,

      /**
       * Is the dataLayer price tax-exclusive?
       *
       * UNKNOWN, and null means unknown rather than false. Both siblings print
       * "Pre-tax · No credit check" under the teaser because on those engines
       * the basis was established empirically. Nothing establishes it here:
       * Olive's item.price matched the on-screen total for the stay, which says
       * the two agree with each other and nothing at all about tax.
       *
       * While this is null the teaser says only "No credit check" and the modal
       * says "Based on the rate shown on this page". Set it true once someone
       * has actually checked an Olive booking through to a tax line, and the
       * "Pre-tax" claim comes back on both surfaces.
       * @type {boolean|null}
       */
      priceIsTaxExclusive: null,

      placement: {
        /** Gap above the teaser, so it reads as its own line. */
        marginTopPx: 8,
      },
    },

    /**
     * CHECKOUT STEP — the "Trip Summary" card on
     * /rooms/#/detroit-foundation/{room}/booking/?oliveSrc=rooms&cart=...
     *
     * The card renders, in order: a thumbnail, the room name, a date range and
     * guest count ("Dec 16 - 17 | 2 Guests"), a collapsible "Nightly Rate" row
     * with an amount, a collapsible "Taxes and Fees" row with an amount, a
     * cancellation line, and a "Total" row with the tax-inclusive amount.
     *
     * TEXT, not selectors, for the same reason the rate cards are: every class
     * on this engine is a build hash.
     *
     * BASIS IS THE TAX-INCLUSIVE TOTAL, deliberately, and it is a different
     * basis from the rate cards' pre-tax nightly figure. That is why this
     * block's supporting line says only "No credit check" while the rate-card
     * one can say "Pre-tax · No credit check", and why the modal's fine print
     * says "Tax included" for this trigger rather than quoting a pre-tax
     * basis. Same split both siblings carry. It names a processing fee only
     * when CONFIG.blissFeeRate is non-zero, which on this property it is not.
     */
    detailsStep: {
      /**
       * The Total LABEL, as its own element. Anchored on exactly "Total", never
       * on a prefix: "Nightly Rate" and "Taxes and Fees" both render amounts in
       * this same card, and anchoring on any of them would write the plan
       * against a pre-tax figure. "Subtotal" and "Total Reservation" are both
       * excluded by the same anchoring.
       */
      totalLabelRe: /^total\s*:?$/i,

      /** The same word found INSIDE a longer string, for splitting on it. */
      totalLabelInlineRe: /\btotal\b\s*:?/i,

      /**
       * FALLBACK label shape, for a layout that puts the label and the amount
       * in one element ("Total $348.61"). Still refuses a prefix match on
       * anything else, and still capped short so it cannot swallow a paragraph.
       */
      totalInlineRe: /^total\b/i,

      /**
       * What identifies the Trip Summary card itself. The block is placed
       * relative to the Total row, but the DATES are read from this card, so it
       * has to be resolved as a unit. Both markers are required: one of them
       * alone appears in plenty of places, the pair does not.
       */
      summaryMarkersRe: [/nightly\s*rate/i, /taxes?\s*(and|&)\s*fees?/i],

      /** How far to climb from the Total label looking for its row. */
      rowClimbMax: 6,

      /** How far to climb from the Total label looking for the summary card. */
      summaryClimbMax: 12,

      /**
       * How far to climb OUT of the markers container looking for the dates.
       *
       * These are two different scopes and conflating them is what made the
       * block render nothing on the live page. The markers ("Nightly Rate",
       * "Taxes and Fees", "Total") sit in a rows container; the room name and
       * the date line sit ABOVE it as siblings of that container, inside the
       * outer card. Resolving one element for both meant the date search was
       * handed a subtree the dates were never in.
       */
      dateScopeClimbMax: 5,

      /** Longest text a date-range candidate may be before it is ignored. */
      maxDateCandidateLength: 140,

      /** Gap above the block, so it reads as its own line. */
      marginTopPx: 12,
    },

    /** Currency, when the dataLayer item does not carry one. */
    currencyFallback: "USD",

    /**
     * Property identity hook. Display-only: the overlay never posts to Bliss,
     * and on this file it never posts anywhere at all.
     */
    merchantSlug: null,

    /**
     * Corner radii for the trigger line and the modal. Colour is not here: it
     * lives in BLISS_COLORS, which is the single place a palette change is made.
     */
    brand: {
      radius: "4px",
      radiusCard: "16px",
      radiusPill: "999px",
    },

    /**
     * The confirmation renders in place of the button, with the plan rows still
     * on screen so the guest can see and change what they picked, so the modal
     * stays open. Set true to close it on confirm instead.
     */
    closeModalOnConfirm: false,
  };

  // =========================================================================
  // MONEY TEXT PARSING — unchanged from mews-overlay.js
  // =========================================================================

  /**
   * Pulls integer cents out of a rendered price string. Locale-agnostic: the
   * LAST separator wins as the decimal point, so both 1.234,56 and 1,234.56
   * parse. Returns null when the string carries no number.
   */
  function parseMoneyTextToCents(text) {
    var raw = String(text == null ? "" : text).replace(/[^0-9.,]/g, "");
    if (!raw) return null;
    var decimalAt = Math.max(raw.lastIndexOf("."), raw.lastIndexOf(","));
    // A trailing group of 3 digits is a thousands group, not a decimal.
    if (decimalAt !== -1 && raw.length - decimalAt - 1 === 3) decimalAt = -1;
    var normalised =
      decimalAt === -1
        ? raw.replace(/[.,]/g, "")
        : raw.slice(0, decimalAt).replace(/[.,]/g, "") + "." + raw.slice(decimalAt + 1).replace(/[.,]/g, "");
    var n = parseFloat(normalised);
    return isFinite(n) ? Math.round(n * 100) : null;
  }

  /**
   * The Bliss fee rate for this install, normalised. Anything that is not a
   * finite positive number reads as no fee, so a bad override cannot put an
   * NaN through the money path.
   */
  function feeRate() {
    var r = CONFIG.blissFeeRate;
    return typeof r === "number" && isFinite(r) && r > 0 ? r : 0;
  }

  /**
   * Applies the Bliss fee to a basis. THE ONLY PLACE THE RATE IS APPLIED, on
   * either surface: the rate cards' nightly figure and stay total, and the
   * checkout block's tax-inclusive Total, all come through here. That is what
   * keeps the teaser and the modal on one basis — fee x nightly x nights ==
   * fee x stay total — and what makes the rate a single value to change.
   *
   * At the zero rate this returns the basis unchanged, so the guest's plan
   * totals exactly what the property's own page says the stay costs.
   */
  function withFee(cents) {
    if (cents == null || !isFinite(cents)) return null;
    var rate = feeRate();
    if (!rate) return cents;
    return Math.round(cents * (1 + rate));
  }

  var SYMBOL_CURRENCY = { "$": "USD", "£": "GBP", "€": "EUR", "¥": "JPY", "₹": "INR" };

  /** Best-effort currency. Ambiguous by nature, which is why CONFIG wins. */
  function rememberCurrencyHint(text) {
    var m = /[$£€¥₹]|\b(USD|GBP|EUR|CHF|SEK|NOK|DKK|PLN|AUD|CAD)\b/.exec(String(text || ""));
    if (!m) return;
    state.currencyHint = SYMBOL_CURRENCY[m[0]] || m[0];
  }

  /**
   * True when an element is rendered struck through, checked up its ancestor
   * chain as far as the card.
   *
   * text-decoration does not inherit as a computed value: a span inside a <del>
   * reports "none" for itself while still rendering with a line through it. The
   * ancestor walk is what catches that, along with plain <s>/<del>/<strike>.
   *
   * Kept from both siblings. Olive renders a discounted rate as a struck
   * comparison-price beside the effective one, so a card-matching pass that
   * counted the struck figure would match the card to the wrong rate.
   */
  function isStruckThrough(el, card) {
    var win = ownerWin(el);
    var node = el;
    for (var depth = 0; node && node !== card && depth < 8; depth++) {
      var tag = node.tagName ? node.tagName.toLowerCase() : "";
      if (tag === "s" || tag === "del" || tag === "strike") return true;
      var cs = null;
      try {
        cs = win.getComputedStyle(node);
      } catch (e) {
        cs = null;
      }
      if (cs) {
        var line = String(cs.textDecorationLine || cs.textDecoration || "");
        if (line.indexOf("line-through") !== -1) return true;
      }
      node = node.parentNode;
    }
    return false;
  }

  // =========================================================================
  // ELIGIBILITY — verbatim port of frontend/lib/eligibility.ts
  // Identical to the same section of both siblings. Do not edit in isolation.
  // =========================================================================

  var FREQUENCY_DAYS = { biweekly: 14, monthly: 30 };
  var MIN_FINAL_PAYMENT_BUFFER_DAYS = 3;
  // Monthly only: the first installment (payment 2) must be at least this many
  // days after the booking date, else it skips to the following month so it
  // isn't a same-week double charge against the immediate payment 1.
  var MONTHLY_FIRST_INSTALLMENT_MIN_GAP_DAYS = 14;

  function previewEligibility(today, appointmentDate, totalAmountCents, rules) {
    if (!appointmentDate || isNaN(appointmentDate.getTime())) {
      return ineligible("invalid_input", 0, 0, totalAmountCents, totalAmountCents);
    }
    var days = daysBetween(today, appointmentDate);
    var weeks = Math.floor(days / 7);
    var discountedTotal = applyDiscountCents(totalAmountCents, rules);

    if (weeks < rules.minLeadTimeWeeks) {
      return ineligible("too_close", days, 0, totalAmountCents, discountedTotal);
    }
    if (rules.maxLeadTimeWeeks != null && weeks > rules.maxLeadTimeWeeks) {
      return ineligible("too_far", days, 0, totalAmountCents, discountedTotal);
    }
    if (
      rules.minBookingAmountCents != null &&
      totalAmountCents > 0 &&
      totalAmountCents < rules.minBookingAmountCents
    ) {
      return ineligible("amount_too_low", days, 0, totalAmountCents, discountedTotal);
    }
    if (rules.maxBookingAmountCents != null && totalAmountCents > rules.maxBookingAmountCents) {
      return ineligible("amount_too_high", days, 0, totalAmountCents, discountedTotal);
    }

    var deposit = computeDepositCents(discountedTotal, rules);
    if (deposit > 0 && deposit >= discountedTotal) {
      return ineligible("deposit_too_high", days, deposit, totalAmountCents, discountedTotal);
    }
    var installmentTotal = discountedTotal - deposit;
    var hasDeposit = deposit > 0;

    var allowedFrequencies =
      rules.allowedFrequencies === "monthly"
        ? ["monthly"]
        : rules.allowedFrequencies === "biweekly"
          ? ["biweekly"]
          : ["biweekly", "monthly"];

    var recommended = resolveRecommended(rules);
    var dueOffsetDays = paymentDueOffsetDays(rules);

    var options = [];
    for (var i = 0; i < allowedFrequencies.length; i++) {
      var built = buildInstallments(
        today,
        appointmentDate,
        installmentTotal,
        hasDeposit,
        allowedFrequencies[i],
        dueOffsetDays
      );
      if (built) {
        built.recommended = recommended != null && built.frequency === recommended;
        options.push(built);
      }
    }

    if (options.length === 0) {
      return ineligible("no_plan_fits", days, deposit, totalAmountCents, discountedTotal);
    }

    return {
      eligible: true,
      reason: "ok",
      daysToAppointment: days,
      depositAmountCents: deposit,
      originalTotalAmountCents: totalAmountCents,
      discountedTotalAmountCents: discountedTotal,
      options: options,
    };
  }

  function ineligible(reason, daysToAppointment, depositAmountCents, originalTotal, discountedTotal) {
    return {
      eligible: false,
      reason: reason,
      daysToAppointment: daysToAppointment,
      depositAmountCents: depositAmountCents,
      originalTotalAmountCents: originalTotal,
      discountedTotalAmountCents: discountedTotal,
      options: [],
    };
  }

  function applyDiscountCents(totalCents, rules) {
    var bp = rules.discountBasisPoints;
    if (bp <= 0 || totalCents <= 0) return totalCents;
    return Math.floor((totalCents * (10000 - bp)) / 10000);
  }

  function computeDepositCents(totalCents, rules) {
    if (!rules.depositRequired || rules.depositType == null || rules.depositValue == null) {
      return 0;
    }
    var raw =
      rules.depositType === "percentage"
        ? Math.floor((totalCents * rules.depositValue) / 100)
        : rules.depositValue;
    if (rules.depositMaxCents != null) raw = Math.min(raw, rules.depositMaxCents);
    return Math.max(0, Math.min(raw, totalCents));
  }

  // How many days before the appointment all installments must clear by.
  function paymentDueOffsetDays(rules) {
    switch (rules.paymentDuePolicy) {
      case "at_appointment":
        return 0;
      case "one_week_before":
        return 7;
      case "one_month_before":
        return 30;
      case "custom_months":
        // Stored value is days before check-in (field name kept for wire compat).
        return rules.paymentDueCustomMonths == null ? 0 : rules.paymentDueCustomMonths;
      default:
        return 0;
    }
  }

  function resolveRecommended(rules) {
    if (rules.allowedFrequencies !== "both") return null;
    if (rules.recommendedFrequency != null) return rules.recommendedFrequency;
    return "monthly";
  }

  function buildInstallments(today, appointmentDate, installmentTotalCents, hasDeposit, frequency, dueOffsetDays) {
    var days = daysBetween(today, appointmentDate);
    var intervalDays = FREQUENCY_DAYS[frequency];
    // The merchant's "all payments due by X days before appointment" rule is a
    // tighter version of the system 3-day retry buffer. Whichever is larger wins.
    var effectiveBuffer = Math.max(MIN_FINAL_PAYMENT_BUFFER_DAYS, dueOffsetDays);
    var usable = days - effectiveBuffer;
    if (usable < 0) return null;

    var dueDates;
    if (frequency === "monthly") {
      // Payment 1 is the immediate charge on the booking date itself. Payments
      // 2..N collect on a fixed monthly anchor (the 2nd or 16th, chosen by
      // booking date), each resolved through the weekend roll-forward.
      var cutoff = addDays(appointmentDate, -effectiveBuffer);
      dueDates = monthlyDueDates(today, cutoff, hasDeposit);
      if (dueDates.length === 0) return null;
      if (!hasDeposit && dueDates.length < 2) return null;
    } else {
      var intervals = Math.floor(usable / intervalDays);
      var n = hasDeposit ? intervals : 1 + intervals;
      if (n < 1) return null;
      if (!hasDeposit && n < 2) return null;
      dueDates = [];
      var startMultiplier = hasDeposit ? 1 : 0;
      for (var i = 0; i < n; i++) {
        dueDates.push(formatDate(rollForwardToWeekday(addDays(today, (startMultiplier + i) * intervalDays))));
      }
    }

    var numPayments = dueDates.length;
    if (numPayments < 1) return null;
    if (installmentTotalCents <= 0) return null;

    var perPayment = Math.floor(installmentTotalCents / numPayments);
    var remainder = installmentTotalCents - perPayment * numPayments;
    var finalPayment = perPayment + remainder;

    return {
      frequency: frequency,
      numPayments: numPayments,
      perPaymentAmountCents: perPayment,
      finalPaymentAmountCents: finalPayment,
      dueDates: dueDates,
      recommended: false,
    };
  }

  // Payment 1 is the immediate charge on the booking date (no anchor logic) but
  // rolled forward off weekends, included only when there is no separate
  // deposit. Installments collect on a fixed monthly anchor.
  function monthlyDueDates(today, cutoff, hasDeposit) {
    var dates = [];
    if (!hasDeposit) {
      dates.push(formatDate(rollForwardToWeekday(today)));
    }
    var anchorDay = monthlyAnchorDay(today.getDate());
    var cursor = new Date(today.getFullYear(), today.getMonth(), anchorDay);
    while (daysBetween(today, cursor) < MONTHLY_FIRST_INSTALLMENT_MIN_GAP_DAYS) {
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, anchorDay);
    }
    for (;;) {
      var due = rollForwardToWeekday(cursor);
      if (due.getTime() > cutoff.getTime()) break;
      dates.push(formatDate(due));
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, anchorDay);
    }
    return dates;
  }

  // day 1-10 or 26-end -> the 2nd; day 11-25 -> the 16th.
  function monthlyAnchorDay(bookingDayOfMonth) {
    return bookingDayOfMonth >= 11 && bookingDayOfMonth <= 25 ? 16 : 2;
  }

  function daysBetween(a, b) {
    var aUtc = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
    var bUtc = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
    return Math.floor((bUtc - aUtc) / (1000 * 60 * 60 * 24));
  }

  function addDays(d, n) {
    var next = new Date(d.getTime());
    next.setDate(next.getDate() + n);
    return next;
  }

  // Saturday and Sunday both roll FORWARD to the following Monday. Never rolls
  // backward, so an adjusted date is never earlier than its computed date.
  function rollForwardToWeekday(d) {
    var day = d.getDay(); // 0 = Sunday, 6 = Saturday
    if (day === 6) return addDays(d, 2);
    if (day === 0) return addDays(d, 1);
    return d;
  }

  function formatDate(d) {
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }

  /** Parses YYYY-MM-DD as a LOCAL date. new Date("2026-12-25") would be UTC. */
  function parseLocalDate(iso) {
    if (!iso || typeof iso !== "string") return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim());
    if (!m) return null;
    var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return isNaN(d.getTime()) ? null : d;
  }

  function startOfToday() {
    var n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate());
  }

  // =========================================================================
  // DATALAYER + STAY
  //
  // Olive publishes a GA4-shaped dataLayer. The entry that matters is
  // view_item_list, whose ecommerce.items array holds the rates:
  //
  //   {"affiliation":"olive","currency":"USD",
  //    "item_brand":"ol_pty_... — Detroit Foundation Hotel",
  //    "item_category":"Plan Ahead ","item_category2":"D-ADVP",
  //    "item_id":"K1D","item_name":"Deluxe King",
  //    "price":302.72,"quantity":2}
  //
  // price is PER NIGHT and quantity is NIGHTS, so the stay total is the product.
  // item_category is the rate name and arrives with a trailing space.
  //
  // The array carries rates for every room in the property, not just the room on
  // screen. That is the whole reason discovery is inverted — see DISCOVERY.
  // dataLayer is append-only, so every read takes the LAST matching entry.
  // =========================================================================

  /** Query string to a plain object, tolerant of a malformed escape. */
  function queryParams(search) {
    var out = {};
    var raw = String(search || "");
    var at = raw.indexOf("?");
    raw = at === -1 ? raw.replace(/^\?/, "") : raw.slice(at + 1);
    if (!raw) return out;
    var parts = raw.split("&");
    for (var i = 0; i < parts.length; i++) {
      if (!parts[i]) continue;
      var eq = parts[i].indexOf("=");
      var k = eq === -1 ? parts[i] : parts[i].slice(0, eq);
      var v = eq === -1 ? "" : parts[i].slice(eq + 1);
      try {
        k = decodeURIComponent(k.replace(/\+/g, " "));
        v = decodeURIComponent(v.replace(/\+/g, " "));
      } catch (e) {
        /* keep the raw value */
      }
      if (out[k] === undefined) out[k] = v;
    }
    return out;
  }

  function firstParam(params, names) {
    for (var i = 0; i < names.length; i++) {
      var v = params[names[i]];
      if (v != null && String(v).trim() !== "") return String(v).trim();
    }
    return null;
  }

  /**
   * The stay dates, hash first and query string second.
   *
   * OLIVE IS A HASH ROUTER: on the rooms page location.search is empty and the
   * params sit after the first "?" inside location.hash. Other Olive surfaces
   * use the real query string, so both are read and whichever actually yields a
   * startDate wins rather than whichever happens to be non-empty.
   */
  function readStayDates() {
    var sources = [];
    try {
      sources.push({ where: "location.hash", params: queryParams(window.location.hash) });
    } catch (e) {
      /* ignore */
    }
    try {
      sources.push({ where: "location.search", params: queryParams(window.location.search) });
    } catch (e) {
      /* ignore */
    }

    var partial = { checkin: null, checkout: null, source: null };
    for (var i = 0; i < sources.length; i++) {
      var p = sources[i].params;
      var checkin = parseLocalDate(firstParam(p, CONFIG.stay.checkinParams));
      var checkout = parseLocalDate(firstParam(p, CONFIG.stay.checkoutParams));
      if (checkin) {
        return {
          checkin: checkin,
          checkout: checkout,
          source: sources[i].where,
          adults: p.adults == null ? null : p.adults,
          children: p.children == null ? null : p.children,
        };
      }
      if (checkout && !partial.checkout) {
        partial.checkout = checkout;
        partial.source = sources[i].where + " (endDate only)";
      }
    }
    return partial;
  }

  /** dataLayer is append-only: walk backwards and take the first match. */
  function lastEventWithItems(dl) {
    if (!dl || typeof dl.length !== "number") return null;
    for (var i = dl.length - 1; i >= 0; i--) {
      var e = dl[i];
      if (!e || typeof e !== "object") continue;
      var ec = e.ecommerce;
      if (ec && ec.items && ec.items.length) return e;
    }
    return null;
  }

  /** "ol_pty_xxx — Detroit Foundation Hotel" -> "Detroit Foundation Hotel". */
  function hotelNameFromBrand(brand) {
    if (!brand) return null;
    var s = String(brand);
    var parts = s.split(/\s[—–-]\s/);
    var tail = parts.length > 1 ? parts[parts.length - 1] : s;
    tail = tail.replace(/\s+/g, " ").trim();
    return tail || null;
  }

  function normalizeItems(raw) {
    var out = [];
    if (!raw || typeof raw.length !== "number") return out;
    for (var i = 0; i < raw.length; i++) {
      var it = raw[i];
      if (!it || typeof it !== "object") continue;
      var price = Number(it.price);
      if (!isFinite(price) || price <= 0) continue;
      var nights = Number(it.quantity);
      if (!isFinite(nights) || nights <= 0) nights = null;
      out.push({
        id: it.item_id == null ? null : String(it.item_id),
        // item_category is the rate name and arrives with a trailing space.
        rateName: it.item_category == null ? null : String(it.item_category).replace(/\s+/g, " ").trim(),
        rateCode: it.item_category2 == null ? null : String(it.item_category2).replace(/\s+/g, " ").trim(),
        roomName: it.item_name == null ? null : String(it.item_name).replace(/\s+/g, " ").trim(),
        currency: it.currency == null ? null : String(it.currency),
        hotelName: hotelNameFromBrand(it.item_brand),
        nightlyCents: Math.round(price * 100),
        nights: nights,
        raw: it,
      });
    }
    return out;
  }

  // One-shot per distinct parsed stay, so a per-mutation sync cannot spam the
  // console while still reporting every genuine change.
  var lastLoggedStayKey = null;

  /**
   * Everything read from the page, in one snapshot. Named readDataLayer to
   * match both siblings, and returns the same shape, so every downstream
   * consumer (computeFor, renderModal, confirmPlan) is untouched.
   */
  function readDataLayer() {
    var dl = null;
    try {
      dl = window.dataLayer;
    } catch (e) {
      dl = null;
    }
    var evt = lastEventWithItems(dl);
    var items = normalizeItems(evt && evt.ecommerce && evt.ecommerce.items);

    var stay = readStayDates();
    var checkin = stay.checkin;
    var checkout = stay.checkout;

    // Nights: the dataLayer's own quantity is authoritative, because it is what
    // the price is quoted against. The URL is the cross-check, and a
    // disagreement is reported rather than silently resolved — the two
    // disagreeing means the page is mid-update and the next sync will settle it.
    var urlNights = checkin && checkout ? daysBetween(checkin, checkout) : null;
    var itemNights = items.length && items[0].nights != null ? items[0].nights : null;
    var nights = itemNights != null ? itemNights : urlNights;
    if (nights != null && nights <= 0) nights = null;

    // A checkout the URL did not carry, derived so the modal can still state the
    // stay. Never used for the money: nights above is what the price multiplies.
    if (checkin && !checkout && nights != null) checkout = addDays(checkin, nights);

    var checkinIso = checkin ? formatDate(checkin) : null;
    var checkoutIso = checkout ? formatDate(checkout) : null;

    var key = [checkinIso, checkoutIso, nights, stay.source, items.length].join("|");
    if (CONFIG.stay.logEveryRead || key !== lastLoggedStayKey) {
      lastLoggedStayKey = key;
      if (checkin) {
        console.log(
          "[bliss] stay: check-in " + checkinIso +
            "  |  check-out " + checkoutIso +
            "  |  nights " + nights +
            "  |  dates from: " + stay.source +
            "  |  dataLayer rates: " + items.length +
            (urlNights != null && itemNights != null && urlNights !== itemNights
              ? "  |  NIGHTS DISAGREE: URL says " + urlNights + ", dataLayer quantity says " + itemNights +
                ", using the dataLayer"
              : "")
        );
      } else {
        console.warn(
          "[bliss] no usable check-in date. Olive is a hash router, so the dates live after the " +
            'first "?" inside location.hash; neither that nor location.search carried one of ' +
            CONFIG.stay.checkinParams.join(", ") + ". Every figure needs a stay, so nothing will render."
        );
      }
    }

    return {
      items: items,
      sawDataLayer: !!(dl && typeof dl.length === "number"),
      dataLayerLength: dl && typeof dl.length === "number" ? dl.length : 0,
      staySource: stay.source,
      checkinIso: checkinIso,
      checkoutIso: checkoutIso,
      checkin: checkin,
      checkout: checkout,
      nights: nights,
      adults: stay.adults == null ? null : stay.adults,
      children: stay.children == null ? null : stay.children,
      currency: (items[0] && items[0].currency) || null,
      hotelName: (items[0] && items[0].hotelName) || null,
      itemName: (items[0] && items[0].roomName) || null,
      itemVariant: (items[0] && items[0].rateCode) || null,
      value: null,
      hotelId: null,
      sawCart: false,
    };
  }

  // =========================================================================
  // RATE CARD DISCOVERY — structural, then matched to a dataLayer item
  //
  // Olive is CSS-modules: price__CYdhm, price-value__PFyjN,
  // comparison-price__AaBG1. Those hashes change on every Olive deploy, so
  // there is no selector to match on and nothing below uses one.
  //
  // A rate card is an element carrying ALL THREE of: a per-night price, a rate
  // name ELEMENT, and a conditions line. None of the three consults the
  // dataLayer — see findRateNameEl for why the dataLayer test had to go.
  //
  // Two earlier boundaries were wrong and are worth naming so they are not
  // reintroduced. A cap on booking controls per card admitted the whole rate
  // list (two cards of one control each give the list a count of two). A
  // repetition test — "my parent holds two price-bearing children" — admitted
  // the ROOM DESCRIPTION BLOCK, which has buttons and sits beside priced
  // content but is not a rate. Only content the card is defined by works.
  // =========================================================================

  function normText(el) {
    if (!el) return "";
    return String(el.textContent || "").replace(/\s+/g, " ").trim();
  }

  function normalizeName(s) {
    return String(s == null ? "" : s).replace(/\s+/g, " ").trim().toLowerCase();
  }

  /** Does this element occupy space on the page right now? */
  function hasBox(el) {
    if (!el || el.nodeType !== 1) return false;
    try {
      var r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    } catch (e) {
      return false;
    }
  }

  /** True for anything the overlay itself injected. */
  function isOurNode(el) {
    var cur = el;
    for (var d = 0; cur && d < 60; d++) {
      if (cur.nodeType === 1) {
        if (cur.hasAttribute && cur.hasAttribute(BADGE_ATTR)) return true;
        if (cur.id === MODAL_HOST_ID) return true;
      }
      cur = cur.parentNode;
    }
    return false;
  }

  function ctaCount(el) {
    if (!el) return 0;
    var hits;
    try {
      hits = el.querySelectorAll(CONFIG.rateCards.ctaSelector);
    } catch (e) {
      return 0;
    }
    var n = 0;
    for (var i = 0; i < hits.length; i++) {
      if (isOurNode(hits[i])) continue;
      n++;
    }
    return n;
  }

  /**
   * The price-shaped leaves on the page: the elements card discovery starts
   * climbing from.
   *
   * Leaves only, and struck-through ones are skipped, so a discounted rate's
   * crossed-out comparison price is not an anchor of its own. That matters for
   * matching rather than for the money — the amount comes from the dataLayer —
   * but a struck anchor would still be an extra anchor resolving to the same
   * card, and one anchor per card keeps the dedupe honest.
   */
  function findPriceAnchors(root) {
    var all;
    try {
      all = (root || document).querySelectorAll("*");
    } catch (e) {
      return [];
    }
    var re = CONFIG.rateCards.amountRe;
    var out = [];
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el.children && el.children.length) continue;
      if (isOurNode(el)) continue;
      var t = normText(el);
      if (!t || t.length > 40) continue;
      if (!re.test(t)) continue;
      if (!hasBox(el)) continue;
      if (isStruckThrough(el, null)) continue;
      out.push(el);
      if (out.length > 200) break;
    }
    return out;
  }

  /**
   * THE CARD TEST. Three signals, all required.
   *
   *   1. a PER-NIGHT PRICE   money AND a per-night marker in the same node
   *   2. a RATE NAME         one of the dataLayer's own item_category /
   *                          item_category2 strings, found in the text
   *   3. a CONDITIONS LINE   the card's rate-conditions sentence
   *
   * This replaces a structural heuristic (a booking control, plus a parent with
   * two price-bearing children) that was wrong in both directions on the live
   * page. It accepted the ROOM DESCRIPTION BLOCK at the top of the page — room
   * name plus marketing paragraph, no price, no rate, no conditions — because
   * that block has buttons in it and sits beside other price-bearing content.
   * And it let fee chips ("+$4", "$45", "$100" for parking and resort fees)
   * seed candidates, because any money-shaped leaf was a seed.
   *
   * All three signals are content the rate card is DEFINED by, so none of them
   * can be present on a room description or a fee row. Signal 2 is checked
   * against the dataLayer rather than a guess at what a rate name looks like,
   * which is the same reasoning that makes the amounts trustworthy: the engine
   * tells us the names, so we do not have to invent a pattern for them.
   */
  /**
   * How many distinct PRICE BLOCKS sit inside this node, capped.
   *
   * The cardinality stop, and it replaces counting per-night markers, which
   * cannot work on a layout that renders none. A rate card holds one price
   * block; a room column holding two rate cards holds two; the rate list holds
   * one per card. So the first ancestor holding more than one is the list, and
   * the climb stops before taking it.
   *
   * COUNTED BY PARENT, NOT BY PRICE, and that distinction is the whole
   * correctness of it. A discounted card renders TWO money leaves — the struck
   * comparison and the live price — as siblings of one block. Counting leaves
   * makes such a card look like a list of two and stops the climb below it,
   * which is a regression this file already knows to expect: scrapeCardNightlyCents
   * documents that a strikethrough can be styled in ways getComputedStyle does
   * not report, so "the struck one is excluded" cannot be relied on here.
   * Their shared parent collapses the pair back to one either way.
   */
  function distinctPriceParents(node, anchors, cap) {
    var parents = [];
    for (var i = 0; i < anchors.length; i++) {
      var a = anchors[i];
      if (node !== a && !node.contains(a)) continue;
      var p = a.parentNode || a;
      if (parents.indexOf(p) !== -1) continue;
      parents.push(p);
      if (parents.length >= cap) return parents.length;
    }
    return parents.length;
  }

  /**
   * How many distinct conditions LINES a node holds, capped. One per rate card
   * by definition, so more than one means the node is a list.
   *
   * COUNTED AS ELEMENTS, NOT AS REGEX MATCHES. conditionsRe is an alternation
   * of a dozen terms and a single real conditions sentence trips several of
   * them at once — "This rate is prepaid at time of booking and is
   * non-changeable" matches both `prepaid` and `non-changeable`. Counting
   * matches therefore reported two conditions lines for every card and stopped
   * the climb below every card on the page. Counting the elements that carry
   * such text asks the question that was actually meant.
   */
  function distinctConditionEls(node, cap) {
    var all;
    try {
      all = node.querySelectorAll("*");
    } catch (e) {
      return 0;
    }
    var n = 0;
    var re = CONFIG.rateCards.conditionsRe;
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el.children && el.children.length) continue;
      if (isOurNode(el)) continue;
      if (!re.test(normText(el))) continue;
      n++;
      if (n >= cap) return n;
    }
    return n;
  }

  function countPerNight(text) {
    var re = new RegExp(CONFIG.rateCards.perNightRe.source, "gi");
    var m = String(text || "").match(re);
    return m ? m.length : 0;
  }

  /**
   * RATE NAME MATCHING. One function, used by BOTH discovery (rateSignals) and
   * assignment (matchItemForCard), so the two cannot disagree — a card found on
   * a loose match and then assigned on a strict one would be discovered and
   * then matched to nothing, which is a teaser that never appears.
   *
   * Exact containment was too strict on the live page: "The Detroit Foundation
   * Exclusive Rate" is what the card displays, and whatever the dataLayer calls
   * that rate did not appear inside it verbatim. Four rules, most precise
   * first, so a loose one is only reached when the precise ones cannot answer:
   *
   *   1. RATE CODE   the item_category2 string appears in the card. Most
   *                  precise thing available, and free when the engine renders
   *                  it.
   *   2. EXACT NAME  the item_category string appears verbatim.
   *   3. TOKENS      the name's distinctive words appear, in any order, with
   *                  filler dropped. "The Detroit Foundation Exclusive Rate"
   *                  reduces to detroit/foundation/exclusive, so it matches a
   *                  card that words the same rate differently, and matches in
   *                  EITHER direction — a dataLayer name longer than the
   *                  display name still lands, because the test is overlap
   *                  rather than containment.
   *   4. ONE STRONG  a single long distinctive word carries the match on its
   *                  own ("exclusive"), for the case where the dataLayer name
   *                  and the display name share only that word.
   *
   * WHY LOOSENING THIS CANNOT READMIT THE ROOM BLOCK OR A FEE CHIP. The rate
   * name is one of three independent signals, and it is the only one being
   * loosened. The room description block fails on the per-night price, which is
   * untouched and strict; the fee chips fail at the seed gate before a card is
   * ever resolved. Even a deliberately hostile room block carrying the words
   * "Detroit Foundation" cannot become a rate card, because it still quotes no
   * price per night. There is a test for exactly that.
   */
  var RATE_STOPWORDS = {
    the: 1, a: 1, an: 1, of: 1, and: 1, or: 1, for: 1, with: 1, our: 1, your: 1,
    per: 1, night: 1, nights: 1, nightly: 1, rate: 1, rates: 1, price: 1,
    prices: 1, from: 1, only: 1, room: 1, rooms: 1, booking: 1, book: 1,
  };

  /** Distinctive words in a name: lowercased, de-punctuated, filler dropped. */
  function rateTokens(s) {
    var raw = normalizeName(s).replace(/[^a-z0-9]+/g, " ").trim();
    if (!raw) return [];
    var parts = raw.split(/\s+/);
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var w = parts[i];
      if (!w || w.length < 2 || RATE_STOPWORDS[w]) continue;
      if (out.indexOf(w) === -1) out.push(w);
    }
    return out;
  }

  /** Every word in a card's text, as a lookup. Built once per card. */
  function wordSet(text) {
    var set = {};
    var parts = normalizeName(text).replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/);
    for (var i = 0; i < parts.length; i++) if (parts[i]) set[parts[i]] = 1;
    return set;
  }

  /**
   * Does this card show this rate? Returns null, or how it matched and how
   * strongly, so the caller can rank competing items and the log can say which
   * rule fired.
   */
  function rateNameMatch(cardText, words, item) {
    var hay = normalizeName(cardText);

    var code = normalizeName(item.rateCode);
    if (code && code.length >= 3 && hay.indexOf(code) !== -1) {
      return { how: "rate code " + JSON.stringify(item.rateCode), label: item.rateCode, score: 100 };
    }

    var name = normalizeName(item.rateName);
    if (!name) return null;
    if (hay.indexOf(name) !== -1) {
      return { how: "exact name", label: item.rateName, score: 90 };
    }

    var toks = rateTokens(item.rateName);
    if (!toks.length) return null;
    var hit = [];
    for (var i = 0; i < toks.length; i++) if (words[toks[i]]) hit.push(toks[i]);
    if (!hit.length) return null;
    var ratio = hit.length / toks.length;

    if (toks.length === 1) {
      return toks[0].length >= 4
        ? { how: "single distinctive word " + JSON.stringify(toks[0]), label: item.rateName, score: 50 }
        : null;
    }
    if (hit.length >= 2 && ratio >= 0.6) {
      return {
        how: "token overlap " + hit.length + "/" + toks.length + " [" + hit.join(", ") + "]",
        label: item.rateName,
        score: 40 + hit.length * 5 + Math.round(ratio * 10),
      };
    }
    // One word out of several, but a long and distinctive one. This is the rule
    // that catches a dataLayer name and a display name sharing only their
    // defining word.
    var longest = "";
    for (var j = 0; j < hit.length; j++) if (hit[j].length > longest.length) longest = hit[j];
    if (ratio >= 0.5 && longest.length >= 6) {
      return { how: "one strong word " + JSON.stringify(longest), label: item.rateName, score: 30 };
    }
    return null;
  }

  /**
   * THE RATE NAME ELEMENT — a structural signal, not a dataLayer lookup.
   *
   * WHY THIS REPLACED THE DATALAYER TEST. On the live property Olive's
   * view_item_list emits ONE rate per room: all eight items are
   * item_category "Plan Ahead" / item_category2 "D-ADVP", differing only by
   * room. The Detroit Foundation Exclusive Rate is rendered on the page and is
   * absent from the dataLayer entirely. No amount of loosening a name match can
   * find a name that was never published, so the requirement had to go.
   *
   * What remains is what the card itself shows: a short line of text that is
   * not the price, not the per-night marker, not the conditions line, not the
   * description paragraph, and not the button. On these cards that is exactly
   * "Plan Ahead" and "The Detroit Foundation Exclusive Rate".
   *
   * A description paragraph is separated from a name by two things a name never
   * has: sentence length and a full stop. A name is a handful of words and does
   * not end in a period; a description is a sentence. That is a heuristic, and
   * it is doing less work than it looks like it is — the per-night price and
   * the conditions line are still required alongside it, so a false positive
   * here cannot on its own turn anything into a rate card.
   */
  function looksLikeRateName(text) {
    var cfg = CONFIG.rateCards;
    var s = String(text || "").trim();
    if (s.length < 3 || s.length > 70) return false;
    if (cfg.amountRe.test(s)) return false;      // the price, or the struck one
    if (cfg.perNightRe.test(s)) return false;    // the "/ night" marker
    if (cfg.conditionsRe.test(s)) return false;  // the conditions line
    if (!/[a-z]/i.test(s)) return false;         // digits and punctuation only
    if (/[.!?]$/.test(s)) return false;          // a sentence, so a description
    var words = s.split(/\s+/);
    if (words.length > 7) return false;          // a name is short
    var substantial = 0;
    for (var i = 0; i < words.length; i++) if (/[a-z]{3,}/i.test(words[i])) substantial++;
    return substantial >= 1;
  }

  /**
   * The card's rate name element: the FIRST qualifying text in document order,
   * which on these cards is the heading above the description.
   *
   * Anything inside a booking control is skipped. The button's own label
   * ("Book") is a short line of text that is none of the excluded things, so
   * without this the CTA would satisfy the requirement on every card and the
   * signal would mean nothing.
   */
  function findRateNameEl(card) {
    var all;
    try {
      all = card.querySelectorAll("*");
    } catch (e) {
      return null;
    }
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el.children && el.children.length) continue;
      if (isOurNode(el)) continue;
      try {
        if (el.closest(CONFIG.rateCards.ctaSelector)) continue;
      } catch (e) {
        /* closest is fine everywhere this runs; ignore if not */
      }
      var t = normText(el);
      if (!looksLikeRateName(t)) continue;
      return { el: el, text: t };
    }
    return null;
  }

  // =========================================================================
  // CARD PRICE — scraped, and never the struck one
  //
  // Reached whenever the dataLayer has no item for a card, which on this
  // property is every rate but Plan Ahead. The dataLayer stays PREFERRED: it
  // carries cents (302.72) where the card rounds to dollars ($303). It is no
  // longer REQUIRED.
  // =========================================================================

  /** Every money-shaped leaf in a card, with whether it renders struck. */
  function moneyLeaves(card) {
    var all;
    try {
      all = card.querySelectorAll("*");
    } catch (e) {
      return [];
    }
    var out = [];
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el.children && el.children.length) continue;
      if (isOurNode(el)) continue;
      var t = normText(el);
      if (!t || t.length > 40) continue;
      if (!CONFIG.rateCards.amountRe.test(t)) continue;
      var cents = parseMoneyTextToCents(t);
      if (cents == null || cents <= 0) continue;
      out.push({ el: el, text: t, cents: cents, struck: isStruckThrough(el, card) });
    }
    return out;
  }

  /**
   * The card's LIVE nightly price: the one the guest is being charged, never
   * the struck comparison beside it.
   *
   * On these cards $344 is struck and $303 or $310 is live. Two independent
   * defences, because a strikethrough can be styled in ways getComputedStyle
   * does not report (a background gradient, a pseudo-element, a border):
   *
   *   1. drop anything detected as struck, then
   *   2. of what is left, take the LAST in document order.
   *
   * Rule 2 is what makes rule 1 non-critical. Olive renders the comparison
   * first and the live price second, so the last candidate is the live one
   * whether or not the strikethrough was detectable. Even in the pathological
   * case where every candidate reports struck, taking the last still cannot
   * return the $344 that appears first — which is the actual requirement.
   */
  function scrapeCardNightlyCents(card) {
    var leaves = moneyLeaves(card);
    if (!leaves.length) return null;
    var live = [];
    for (var i = 0; i < leaves.length; i++) if (!leaves[i].struck) live.push(leaves[i]);
    var pool = live.length ? live : leaves;
    var pick = pool[pool.length - 1];
    return {
      cents: pick.cents,
      text: pick.text,
      allStruck: live.length === 0,
      candidates: leaves.map(function (l) {
        return l.text + (l.struck ? " (struck)" : "");
      }),
    };
  }

  function rateSignals(node, text, relaxed) {
    var cfg = CONFIG.rateCards;
    // In strict mode a price must be shown per night to count. In relaxed mode
    // the layout renders no such wording, so the price only has to be a price
    // and the other two signals carry the whole burden of identifying a rate.
    var priced = cfg.amountRe.test(text) && (relaxed || cfg.perNightRe.test(text));
    var named = priced ? findRateNameEl(node) : null;
    return {
      // A price on its own is not a rate. "+$40" is a price; "$303/ night" is a
      // rate, and in strict mode the marker is the whole of the difference.
      perNightPrice: priced,
      // Structural, not a dataLayer lookup. See findRateNameEl.
      rateNameEl: named ? named.el : null,
      rateName: named ? named.text : null,
      conditions: cfg.conditionsRe.test(text),
    };
  }

  /**
   * The card that owns a price anchor: the INNERMOST ancestor satisfying the
   * three-way test above.
   *
   * Innermost rather than outermost, and first-match-while-climbing rather than
   * last: every ancestor of a card also contains the card's text, so the
   * outermost match is the page and the innermost is the card. Same shape as
   * ayres-overlay.js resolveCard.
   *
   * CARDINALITY STOP: two per-night markers means this ancestor holds more than
   * one rate, so it is the list and not a card. Without it the climb sails past
   * a card missing one signal and settles on the container holding every card,
   * which is how three rates collapse into one teaser quoting the first rate's
   * price. The marker count is the right thing to count here because a card has
   * exactly one per-night price however many struck comparison prices sit
   * beside it.
   *
   * SECOND PASS, at two of three: a card whose conditions line is worded in a
   * way conditionsRe does not know still identifies as a rate through its
   * per-night price and its rate name, so it gets a teaser rather than being
   * dropped outright. Only the preferred insertion point is lost, and the
   * console says so once. The room description block cannot reach even this
   * pass: it has neither a per-night price nor a rate name.
   */
  function resolveCard(anchorEl, items, rejections, anchors, relaxed) {
    var cfg = CONFIG.rateCards;
    var doc = (anchorEl && anchorEl.ownerDocument) || document;
    anchors = anchors || [];

    // GATE ON THE SEED. A price with no per-night marker beside it is a fee,
    // not a rate, and climbing from it can only ever find the wrong thing.
    //
    // The marker must be found in a node holding EXACTLY ONE of them. Merely
    // finding one somewhere above is not enough: a parking fee's third ancestor
    // is often a page section that also contains the rate list, so "is there a
    // /night anywhere above me" passes for every price on the page. A node with
    // two or more markers is a list, which means the climb left the price's own
    // group without ever finding a rate — so the price was not part of one.
    // SKIPPED IN RELAXED MODE. The gate asks a question the results-list layout
    // has no answer to, and asking it there rejects every price on the page.
    if (!relaxed) {
      var near = anchorEl;
      var isRatePrice = false;
      for (var g = 0; g <= cfg.perNightClimbMax && near && near.nodeType === 1; g++) {
        var n = countPerNight(normText(near));
        if (n > 1) break; // climbed out into a list; this price is not a rate
        if (n === 1) {
          isRatePrice = true;
          break;
        }
        near = near.parentNode;
      }
      if (!isRatePrice) {
        if (rejections) rejections.push({ why: "not a per-night price", text: normText(anchorEl).slice(0, 24) });
        return null;
      }
    }

    var node = anchorEl;
    var twoOfThree = null;
    var closest = null;
    var unnamed = null;

    for (var d = 0; d < cfg.cardClimbMax; d++) {
      node = node.parentNode;
      if (!node || node.nodeType !== 1) break;
      if (node === doc.body || node === doc.documentElement) break;
      if (isOurNode(node)) break;

      var text = normText(node);
      if (text.length > cfg.maxCardTextLength) break;
      // THREE CARDINALITY STOPS, any one of which means "this is the list".
      // No single one covers every layout:
      //   per-night markers  cheapest, and the only one available in strict
      //                      mode on a page that renders them
      //   conditions lines   one per rate card by definition, and unaffected by
      //                      how prices are marked up
      //   price blocks       the one that still works when a column shares a
      //                      single conditions line between two rate cards
      if (countPerNight(text) > 1) break;
      if (distinctConditionEls(node, 2) > 1) break;
      if (distinctPriceParents(node, anchors, 2) > 1) break;

      var sig = rateSignals(node, text, relaxed);
      if (!sig.perNightPrice || !sig.rateName) {
        closest = sig;
        // A node that quotes a price per night but matches no rate name is the
        // interesting failure: it looks exactly like a rate card and is being
        // dropped. Keep its FULL text so the report can show it beside the
        // dataLayer's own names rather than making it a second round trip.
        //
        // The LAST such node, overwritten as the climb widens, not the first.
        // The first is the price block itself ("$355$310/ night"), which shows
        // nothing about why the rate name was not found. The climb stops at the
        // list, so the last one is the widest node still holding a single
        // per-night price — the card, with its rate name in it, which is
        // exactly the text that needs comparing against the inventory.
        if (sig.perNightPrice) unnamed = text;
        continue;
      }
      if (!hasBox(node)) continue;
      if (sig.conditions) return { el: node, rateName: sig.rateName, viaConditions: true };
      // THE TWO-OF-THREE FALLBACK IS STRICT-MODE ONLY.
      //
      // In strict mode the per-night marker has already established that this
      // price is a rate, so a card whose conditions wording we do not recognise
      // is still safely a card. In relaxed mode that evidence is gone, and
      // price + rate-name alone describes a fee row as well as it describes a
      // rate: "Valet parking" is a rate-name-shaped string and "$45" is a
      // price. The conditions line is the only thing left separating them, so
      // there it is required rather than preferred.
      if (!relaxed && !twoOfThree) {
        twoOfThree = { el: node, rateName: sig.rateName, viaConditions: false };
      }
    }

    if (twoOfThree) return twoOfThree;
    if (rejections) {
      rejections.push({
        why: !closest
          ? "no ancestor carried a per-night price and a rate name element"
          : "missing " +
            [!closest.perNightPrice ? "per-night price" : null, !closest.rateName ? "rate name element" : null]
              .filter(Boolean)
              .join(" and "),
        text: normText(anchorEl).slice(0, 24),
        cardText: unnamed || null,
      });
    }
    return null;
  }

  /**
   * The dataLayer item a card is showing.
   *
   * THE INVERSION LIVES HERE. The dataLayer carries rates for every room in the
   * property while the page renders one room, so an item is matched TO a card
   * rather than a card being hunted for an item, and an item that matches no
   * card on screen is simply never used.
   *
   * Scored rather than first-match, because one room page routinely renders
   * several rate plans of the same room: "Deluxe King / Plan Ahead" and
   * "Deluxe King / Flexible" share item_name and are told apart only by
   * item_category, item_category2 or the price. Longest name wins within a
   * field, so a short rate name that is a substring of a longer one cannot
   * steal the match.
   *
   * `claimed` holds the items already taken by earlier cards, so two cards
   * cannot both resolve to the same rate.
   */
  /** Whole dollars, for comparing a rounded display price to a cents figure. */
  function dollars(cents) {
    return cents == null ? null : Math.round(cents / 100);
  }

  /**
   * The dataLayer item a card is showing, or null when the dataLayer does not
   * carry this rate at all.
   *
   * THE DATALAYER IS PREFERRED, NOT REQUIRED. It is worth preferring because it
   * carries cents where the card rounds to dollars: item.price 302.72 against a
   * rendered "$303". It cannot be required, because on this property Olive
   * publishes one rate per room and the Exclusive Rate is simply not in it.
   *
   * TWO GATES, BOTH REQUIRED, because eight items sharing one rate name make a
   * name match worthless on its own:
   *
   *   PRICE   the item's nightly figure must agree with the card's LIVE price
   *           to within a dollar. This is what stops the struck $344 pulling in
   *           a different room's rate: the comparison price is not a candidate
   *           for the live price, so it cannot be matched against either.
   *   NAME    if the card shows a rate name, the item's must match it. This is
   *           what keeps the Exclusive Rate card off a "Plan Ahead" item that
   *           happens to be priced the same.
   *
   * When no item passes both, the caller falls back to the card's own price,
   * which is the same figure the price gate was comparing against — so the
   * money on screen is identical either way. The dataLayer only ever adds
   * precision, never changes the answer.
   */
  function matchItemForCard(card, items, claimed, liveNightlyCents, cardRateName) {
    if (!card || !items || !items.length) return null;
    var hay = normalizeName(normText(card));
    if (!hay) return null;

    var words = wordSet(hay);
    var liveDollars = dollars(liveNightlyCents);
    var best = null;
    var bestScore = 0;

    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (claimed.indexOf(it) !== -1) continue;

      // GATE 1: the price the guest is actually being shown.
      if (liveDollars != null) {
        var d = dollars(it.nightlyCents);
        if (d == null || Math.abs(d - liveDollars) > 1) continue;
      }

      // GATE 2: the rate name on the card, when it shows one.
      var rateM = rateNameMatch(hay, words, it);
      if (cardRateName) {
        var nameOk = rateNameMatch(cardRateName, wordSet(cardRateName), it);
        if (!nameOk) continue;
        rateM = nameOk;
      } else if (liveDollars == null && !rateM) {
        // Neither signal available: nothing to match on.
        continue;
      }

      var score = (rateM ? rateM.score : 0) + (liveDollars != null ? 60 : 0);
      var room = normalizeName(it.roomName);
      if (room && hay.indexOf(room) !== -1) score += 10 + room.length;

      if (score > bestScore) {
        bestScore = score;
        best = it;
      }
    }

    return best;
  }

  /**
   * Where the teaser goes: after the card's own rate-conditions line, which is
   * the "This rate is non-refundable" line the brief points at. Putting it
   * directly under that line is what gives it that line's weight.
   *
   * Returns the DEEPEST element in the card matching, so the teaser lands beside
   * the line itself rather than beside a wrapper that merely contains it.
   *
   * Falls back to the block containing the price, then to the block containing
   * the card's last control, then to appending to the card. Every fallback is
   * still INSIDE the card — there is deliberately no path out of it.
   */
  function findInjectionAnchor(card, priceEl) {
    var deepest = deepestMatch(card, CONFIG.rateCards.conditionsRe);
    if (deepest) return topLevelChildOf(card, deepest);
    if (priceEl) {
      var viaPrice = topLevelChildOf(card, priceEl);
      if (viaPrice) return viaPrice;
    }
    var controls;
    try {
      controls = card.querySelectorAll(CONFIG.rateCards.ctaSelector);
    } catch (e) {
      controls = [];
    }
    for (var i = controls.length - 1; i >= 0; i--) {
      if (isOurNode(controls[i])) continue;
      var viaCta = topLevelChildOf(card, controls[i]);
      if (viaCta) return viaCta;
    }
    return null;
  }

  function deepestMatch(card, re) {
    var all;
    try {
      all = card.querySelectorAll("*");
    } catch (e) {
      return null;
    }
    var best = null;
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (isOurNode(el)) continue;
      if (!re.test(normText(el))) continue;
      if (best == null || best.contains(el)) best = el;
    }
    return best;
  }

  /**
   * The DIRECT CHILD of the card containing `el`.
   *
   * Inserting next to the matched element itself would drop the teaser inside
   * whatever flex row that element sits in, making it a sibling column rather
   * than its own line. Climbing to the card's own child list puts it in the
   * card's block flow, which is what "its own line" actually requires. Same
   * reasoning as mews-overlay.js findInsertionAnchor.
   */
  function topLevelChildOf(card, el) {
    var node = el;
    var guard = 0;
    while (node && node.parentNode !== card && guard++ < 20) node = node.parentNode;
    return node && node.parentNode === card ? node : null;
  }

  /** The room name for a card, for the modal subtitle. */
  /** The page's room heading, for naming a card the dataLayer does not carry. */
  function pageRoomName() {
    var h;
    try {
      h = document.querySelector("h1");
    } catch (e) {
      return null;
    }
    if (!h || isOurNode(h)) return null;
    var t = normText(h);
    return t && t.length <= 60 ? t : null;
  }

  function findRoomName(card, item, cardRateName) {
    if (item) {
      var bits = [];
      if (item.roomName) bits.push(item.roomName);
      if (item.rateName) bits.push(item.rateName);
      if (bits.length) return bits.join(", ").slice(0, 80);
    }
    // No dataLayer item: name it from what the page shows. The room heading is
    // the room being viewed, and the card's own rate name is the rate.
    if (cardRateName) {
      var room = pageRoomName();
      return (room ? room + ", " + cardRateName : cardRateName).slice(0, 80);
    }
    if (!card) return null;
    var hs;
    try {
      hs = card.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"]');
    } catch (e) {
      hs = [];
    }
    for (var i = 0; i < hs.length; i++) {
      var t = normText(hs[i]);
      if (t) return t.slice(0, 80);
    }
    return null;
  }

  /**
   * Content-derived identity for a rate card, and the thing that lets a
   * confirmed plan find its way back to the right card after Olive re-renders
   * the room list.
   *
   * Deliberately NOT DECORATED_ATTR or any other attribute we write: when the
   * SPA replaces the card ELEMENT rather than its children, every attribute we
   * set went with the old node. The rate identity is the only thing that
   * survives both re-render shapes, and the price is left out because it moves
   * when the dates change and the key must not.
   */
  function cardKeyFor(item, cardRateName) {
    // The card's OWN rate name first. It is what survives a re-render, it is
    // present whether or not the dataLayer knows this rate, and it is the only
    // key a DOM-sourced card can have. Falls back to the item's identity for a
    // card that somehow exposes no name.
    if (cardRateName) return "card|" + normalizeName(cardRateName);
    if (!item) return null;
    var bits = [item.roomName, item.rateName, item.rateCode];
    var key = [];
    for (var i = 0; i < bits.length; i++) {
      if (bits[i]) key.push(normalizeName(bits[i]));
    }
    return key.length ? "item|" + key.join("|") : null;
  }

  // =========================================================================
  // HOST THEME SAMPLING — unchanged from both siblings
  //
  // Booking engines are themed per property, so read the live page rather than
  // shipping a palette. Only the FONT is consumed; the colours stay Bliss.
  // =========================================================================

  function parseRgb(str) {
    var m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?/.exec(str || "");
    if (!m) return null;
    return { r: +m[1], g: +m[2], b: +m[3], a: m[4] == null ? 1 : parseFloat(m[4]) };
  }

  function luminance(c) {
    return (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255;
  }

  function saturation(c) {
    var max = Math.max(c.r, c.g, c.b);
    var min = Math.min(c.r, c.g, c.b);
    return max === 0 ? 0 : (max - min) / max;
  }

  function sampleHostTheme(win) {
    win = win || window;
    var doc = win.document;
    if (!doc || !doc.body) (win = window), (doc = window.document);
    var bodyCs = win.getComputedStyle(doc.body);

    var accent = null;
    var radius = null;
    var candidates = doc.querySelectorAll('button, [role="button"], a[class*="button"], input[type="submit"]');
    var best = -1;
    for (var i = 0; i < candidates.length && i < 200; i++) {
      var cs = win.getComputedStyle(candidates[i]);
      var bg = parseRgb(cs.backgroundColor);
      if (!bg || bg.a < 0.9) continue;
      var s = saturation(bg);
      if (s > best) {
        best = s;
        if (s > 0.15) accent = cs.backgroundColor;
        if (radius == null && cs.borderRadius && cs.borderRadius !== "0px") radius = cs.borderRadius;
      }
      if (radius == null && cs.borderRadius && cs.borderRadius !== "0px") radius = cs.borderRadius;
    }

    var surface = null;
    var bodyBg = parseRgb(bodyCs.backgroundColor);
    if (bodyBg && bodyBg.a >= 0.9) surface = bodyCs.backgroundColor;

    var text = bodyCs.color || "#111";
    var textRgb = parseRgb(text);
    var dark = textRgb ? luminance(textRgb) < 0.5 : true;

    return {
      font: bodyCs.fontFamily || "system-ui, sans-serif",
      text: text,
      muted: dark ? "rgba(0,0,0,0.58)" : "rgba(255,255,255,0.66)",
      hairline: dark ? "rgba(0,0,0,0.14)" : "rgba(255,255,255,0.22)",
      surface: surface || (dark ? "#ffffff" : "#111111"),
      accent: accent || text,
      accentText: accent ? contrastOn(parseRgb(accent)) : dark ? "#ffffff" : "#111111",
      radius: radius || "8px",
    };
  }

  function contrastOn(bg) {
    if (!bg) return "#ffffff";
    return luminance(bg) > 0.6 ? "#111111" : "#ffffff";
  }

  // =========================================================================
  // FORMATTING — unchanged from both siblings
  // =========================================================================

  function money(cents, currency) {
    if (cents == null || !isFinite(cents)) return "—";
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: currency || "USD",
      }).format(cents / 100);
    } catch (e) {
      return (cents / 100).toFixed(2) + " " + (currency || "");
    }
  }

  /** Whole units, no cents. Matches the Marbrook teaser's rounding. */
  function moneyWhole(cents, currency) {
    if (cents == null || !isFinite(cents)) return "—";
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: currency || "USD",
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }).format(cents / 100);
    } catch (e) {
      return Math.round(cents / 100) + " " + (currency || "");
    }
  }

  function shortDate(iso) {
    var d = parseLocalDate(iso);
    if (!d) return iso || "—";
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }

  var REASON_COPY = {
    too_close: "This stay is too soon to spread into a plan.",
    too_far: "This stay is too far out for a plan right now.",
    amount_too_low: "This stay is below the minimum for a payment plan.",
    amount_too_high: "This stay is above the maximum for a payment plan.",
    deposit_too_high: "The deposit covers the whole stay, so there is nothing left to spread.",
    no_plan_fits: "No plan fits between today and check-in.",
    invalid_input: "Pick your dates to see payment plan options.",
  };

  // PLACEHOLDER. Deliberately shouty so it cannot be mistaken for shipped copy:
  // the real plan terms have not been written yet, and inventing them here
  // would put terms a guest could rely on onto a live booking page.
  var PLAN_TERMS_LINES = [
    "PLACEHOLDER LINE ONE",
    "PLACEHOLDER LINE TWO",
    "PLACEHOLDER LINE THREE",
  ];

  // =========================================================================
  // OVERLAY
  //
  // Two parts, both in the top document:
  //   1. Rate-card teasers. One per rate card, inserted as a full-width block
  //      sibling after the card's own conditions line, in normal flow. No host
  //      node is wrapped, moved, reparented or restyled. The only mutation is
  //      one added child, which a re-render may discard and the observer then
  //      re-adds.
  //   2. One shared modal, mounted hidden and shown only on click. Until the
  //      guest clicks a teaser, nothing of ours covers host content.
  //
  // Every injected node owns its own shadow root, so host CSS cannot reach in
  // and ours cannot leak out.
  //
  // THERE IS NO FLOATING FALLBACK. A rate with no card, or a card with no rate,
  // is skipped and counted. See DISCOVERY.
  // =========================================================================

  var LEGACY_HOST_ID = "bliss-plan-overlay-host";
  var SUMMARY_HOST_ID = "bliss-plan-summary-host";
  var MODAL_HOST_ID = "bliss-plan-modal-host";
  var BADGE_ATTR = "data-bliss-badge";
  var DECORATED_ATTR = "data-bliss-plan"; // marks a card already injected into
  var POSITIONED_ATTR = "data-bliss-positioned";

  var state = {
    dl: null,
    theme: null,
    currencyHint: null,
    // The confirmed plan for this stay, session-level rather than per-trigger.
    planChoice: null,
    triggers: [], // {id, kind, cardEl, hostEl, root, amountCents, preview, confirmed}
    modal: null, // {triggerId, selected} while open
    nextId: 1,
    lastCardCount: 0,
    lastUnmatchedCount: 0,
  };

  /**
   * rAF must be invoked on window; pulling the reference off and calling it
   * bare throws "Illegal invocation" in Chrome.
   *
   * The setTimeout is not a fallback, it is a backstop that always arms. rAF
   * does not fire in a backgrounded tab, and every caller here sets a latch
   * before scheduling, so an rAF that never runs would strand that latch and
   * silently kill the observer for the rest of the session.
   */
  function schedule(fn) {
    var done = false;
    var once = function () {
      if (done) return;
      done = true;
      fn();
    };
    if (typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(once);
    window.setTimeout(once, 250);
  }

  /** The window that owns an element, for getComputedStyle. */
  function ownerWin(el) {
    var d = el && el.ownerDocument;
    return (d && d.defaultView) || window;
  }

  /**
   * Element factory bound to a document. Kept parameterised, even though there
   * is only one document here, so the render functions stay diffable against
   * both siblings.
   */
  function domFor(doc) {
    return function h(tag, attrs, kids) {
      var el = doc.createElement(tag);
      if (attrs) {
        Object.keys(attrs).forEach(function (k) {
          if (attrs[k] == null) return;
          if (k === "text") el.textContent = attrs[k];
          else if (k.slice(0, 2) === "on") el.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
          else el.setAttribute(k, attrs[k]);
        });
      }
      (kids || []).forEach(function (kid) {
        if (kid) el.appendChild(kid);
      });
      return el;
    };
  }

  /** Per-trigger currency: the matched rate's own, then config, then the sniff. */
  function cur(t) {
    if (t && t.currency) return t.currency;
    if (state.dl && state.dl.currency) return state.dl.currency;
    return CONFIG.currencyFallback || state.currencyHint || "USD";
  }

  // -------------------------------------------------------------------------
  // TEARDOWN — makes a re-paste of this file idempotent.
  // -------------------------------------------------------------------------

  function stripInjectedDom() {
    var doc = document;
    // querySelectorAll, not getElementById: ids are supposed to be unique and
    // ours are, but getElementById returns only the FIRST match, so a page that
    // somehow ends up with two of our hosts keeps one of them forever. Sweeping
    // every match makes the count zero by construction rather than by trust.
    [LEGACY_HOST_ID, SUMMARY_HOST_ID, MODAL_HOST_ID].forEach(function (id) {
      var hits;
      try {
        hits = doc.querySelectorAll('[id="' + id + '"]');
      } catch (e) {
        return;
      }
      for (var i = 0; i < hits.length; i++) {
        if (hits[i].parentNode) hits[i].parentNode.removeChild(hits[i]);
      }
    });
    [].slice.call(doc.querySelectorAll("[" + BADGE_ATTR + "]")).forEach(function (el) {
      if (el.parentNode) el.parentNode.removeChild(el);
    });
    [].slice.call(doc.querySelectorAll("[" + DECORATED_ATTR + "]")).forEach(function (el) {
      el.removeAttribute(DECORATED_ATTR);
    });
    [].slice.call(doc.querySelectorAll("[" + POSITIONED_ATTR + "]")).forEach(function (el) {
      el.style.position = "";
      el.removeAttribute(POSITIONED_ATTR);
    });
  }

  function destroyExisting() {
    var prev = null;
    try {
      prev = window.__blissOverlay;
    } catch (e) {
      prev = null;
    }
    if (prev) {
      try {
        if (typeof prev.__unhook === "function") prev.__unhook();
      } catch (e) {
        /* ignore */
      }
      try {
        if (typeof prev.__unobserve === "function") prev.__unobserve();
      } catch (e) {
        /* ignore */
      }
      // A superseded instance can still have a scheduled sync in flight, and
      // that sync would run against its own state and re-mount its own nodes
      // after this one has installed. __quiesce latches it off; unobserve alone
      // does not, because the callback was queued before the disconnect.
      try {
        if (typeof prev.__quiesce === "function") prev.__quiesce();
      } catch (e) {
        /* ignore */
      }
      try {
        delete window.__blissOverlay;
      } catch (e) {
        /* ignore */
      }
    }
    // The previous demo build of this file published only this name. Call it if
    // it is still around, so pasting this version over that one is clean.
    try {
      if (!prev && typeof window.blissDemoTeardown === "function") window.blissDemoTeardown(true);
    } catch (e) {
      /* ignore */
    }
    stripInjectedDom();
  }

  destroyExisting();

  // -------------------------------------------------------------------------
  // STYLES — unchanged from both siblings
  // -------------------------------------------------------------------------

  function baseCss(theme) {
    return ":host{all:initial}" + "*{box-sizing:border-box;margin:0;padding:0;font-family:" + theme.font + "}";
  }

  function triggerCss(theme) {
    var c = BLISS_COLORS;
    var radius = CONFIG.brand.radius;
    return (
      baseCss(theme) +
      // In-card: plain text on its own line. No border, background, radius,
      // shadow or padding — the outlined pill read as another of the host's
      // controls sitting next to its real ones. This is also point 5 of the
      // brief: the weight of the card's own "This rate is non-refundable" line
      // is exactly what "no chrome, 12px, one line" produces.
      //
      // display:block with inline children, NOT flex. Flex items do not wrap
      // internally, so the amount ran past the card edge and clipped
      // "installments". Inline content wraps mid-phrase, which is why a long
      // line now takes a second row instead of being cut off. A button element
      // also needs its UA background and border explicitly cleared.
      //
      // ALIGNMENT IS NOT SET HERE. mews-overlay.js hardcodes left and
      // ayres-overlay.js hardcodes right, each matching its own engine. Olive's
      // card layout is not fixed across room types, so renderTrigger reads the
      // computed text-align off the line the teaser was inserted after and
      // emits it as a second stylesheet. The teaser then tracks whatever the
      // conditions line above it does.
      ".trig{display:block;width:100%;margin:0;padding:0;background:none;border:0;" +
      "border-radius:0;box-shadow:none;color:" + c.ink + ";font-size:12px;line-height:1.45;" +
      "cursor:pointer;white-space:normal;overflow-wrap:break-word}" +
      ".trig:hover .amt{text-decoration:underline}" +
      ".trig:focus-visible{outline:2px solid " + c.amethyst + ";outline-offset:2px}" +
      // Glyph is white, not ink: white is the label colour on every amethyst
      // fill, and the tick is a fill of exactly that kind.
      ".tick{display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;" +
      "border-radius:" + radius + ";background:" + c.amethyst + ";color:" + c.white + ";font-size:10px;" +
      "margin-right:7px;vertical-align:middle}" +
      ".sep{margin:0 5px;opacity:.55}" +
      ".amt{font-weight:600}" +
      // Supporting line under the main line. display:block is what puts it on
      // its own row beneath the inline main line.
      ".sub{display:block;width:100%;margin-top:2px;font-size:11px;font-weight:400;color:" + c.muted + "}" +
      ".trig[disabled]{cursor:default}"
    );
  }

  /**
   * The modal is the one surface that does NOT take the sampled host palette.
   * Sampling made it wear the property's brand, which read as the hotel
   * speaking rather than Bliss. Only `theme` for the FONT is still consulted
   * (via baseCss), so the modal sits in the page's typography while staying in
   * Bliss colours.
   *
   * Ported verbatim from mews-overlay.js. Do not restyle in isolation.
   */
  function modalCss(theme) {
    var b = CONFIG.brand;
    var c = BLISS_COLORS;
    return (
      baseCss(theme) +
      ".scrim{position:fixed;top:0;right:0;bottom:0;left:0;background:rgba(0,0,0,.44);" +
      "display:flex;align-items:center;justify-content:center;padding:16px}" +
      ".bliss-card{width:560px;max-width:100%;max-height:calc(100vh - 32px);overflow:auto;background:" + c.bone +
      ";color:" + c.ink + ";border:1px solid " + c.hairline + ";border-radius:" + b.radiusCard +
      ";box-shadow:0 18px 56px rgba(0,0,0,.32)}" +
      ".bliss-card:focus{outline:none}" +
      ".head{display:flex;align-items:flex-start;gap:12px;padding:22px 24px;border-bottom:1px solid " + c.hairline + "}" +
      ".head h2{font-size:17px;font-weight:600;line-height:1.3}" +
      ".head p{font-size:13px;color:" + c.muted + ";margin-top:4px;line-height:1.4}" +
      ".x{margin-left:auto;background:none;border:0;cursor:pointer;font-size:20px;line-height:1;color:" + c.muted + "}" +
      ".body{padding:20px 24px 24px}" +
      ".ctx{font-size:13px;color:" + c.muted + ";margin-bottom:2px;line-height:1.5}" +
      // Fine print under the summary line, tracking the basis.
      ".fine{font-size:11px;color:" + c.muted + ";margin-bottom:12px;line-height:1.4}" +
      // Collapsed-by-default disclosure header. Shared by the payment schedule
      // and the plan terms, so the two read as one control repeated rather than
      // as two different treatments.
      ".disc{display:block;width:100%;text-align:left;margin:2px 0 8px;padding:8px 0;background:none;" +
      "border:0;border-top:1px solid " + c.hairline + ";color:" + c.ink +
      ";font-size:12px;font-weight:600;cursor:pointer}" +
      // The inset surfaces in the modal, so they take the sunken fill rather
      // than the card's own bone.
      ".sched{margin:0 0 12px;background:" + c.sunken + ";border:1px solid " + c.hairline +
      ";border-radius:" + b.radius + "}" +
      ".sched .row{display:flex;align-items:center;gap:10px;padding:8px 12px;font-size:12px;" +
      "border-bottom:1px solid " + c.hairline + "}" +
      ".sched .row:last-child{border-bottom:0}" +
      ".sched .n{width:18px;color:" + c.muted + "}" +
      ".sched .d{color:" + c.ink + "}" +
      ".sched .v{margin-left:auto;font-weight:600;color:" + c.ink + "}" +
      // Plan terms: the schedule box's own rules, at the row type size, in the
      // muted ink the schedule uses for its secondary column.
      ".terms{margin:0 0 12px;background:" + c.sunken + ";border:1px solid " + c.hairline +
      ";border-radius:" + b.radius + "}" +
      ".terms .row{display:flex;align-items:center;gap:10px;padding:8px 12px;font-size:12px;color:" + c.muted +
      ";border-bottom:1px solid " + c.hairline + "}" +
      ".terms .row:last-child{border-bottom:0}" +
      ".opt{display:flex;align-items:center;gap:10px;width:100%;text-align:left;padding:11px 12px;margin-bottom:8px;" +
      "background:" + c.bone + ";color:" + c.ink + ";border:1px solid " + c.hairline +
      ";border-radius:" + b.radiusCard + ";cursor:pointer}" +
      ".opt[aria-pressed=\"true\"]{background:" + c.wash + ";border-color:" + c.amethyst +
      ";border-width:2px;padding:10px 11px}" +
      ".opt .lbl{font-size:13px;font-weight:600}" +
      ".opt .sub{font-size:11px;color:" + c.muted + ";margin-top:2px}" +
      ".opt .amt{margin-left:auto;text-align:right}" +
      ".opt .amt b{font-size:14px;font-weight:600;display:block}" +
      ".opt .amt span{font-size:11px;color:" + c.muted + "}" +
      // The wash is opaque by definition rather than composited — an rgba fill
      // or an opacity property would let the card behind it show through, and
      // would drag the chip's ink text down with it.
      ".tag{display:inline-block;font-size:9px;letter-spacing:.4px;text-transform:uppercase;padding:2px 6px;" +
      "border-radius:" + b.radius + ";background:" + c.wash +
      ";border:1px solid " + c.amethyst + ";color:" + c.ink +
      ";margin-left:6px;vertical-align:middle}" +
      ".cta{width:100%;padding:12px;border:0;border-radius:" + b.radiusPill + ";background:" + c.amethyst +
      ";color:" + c.white + ";font-size:13px;font-weight:600;cursor:pointer;margin-top:4px}" +
      ".cta:hover{background:" + c.amethystHover + "}" +
      // Hairline fill with muted ink, not a half-opacity accent: at .5 the pill
      // composited to a pale tint under white text, which is both a failing pair
      // and a tint-only colour used as a fill. Declared after .cta:hover, which
      // it ties with on specificity, so a disabled pill cannot light up on hover.
      ".cta[disabled]{background:" + c.hairline + ";color:" + c.muted + ";cursor:default}" +
      ".note{font-size:11px;color:" + c.muted + ";margin-top:10px;line-height:1.45}" +
      ".msg{font-size:12px;color:" + c.muted + ";line-height:1.5}" +
      // The receipt's subject line. 14px matches the option row's amount, the
      // largest thing in the body it replaces.
      ".plan{margin:2px 0 0;font-size:14px;font-weight:600;line-height:1.4;color:" + c.ink + "}" +
      // Primary ink, and ruled off the list above it with the same hairline
      // .disc uses above Payment schedule, so it reads as a change of state.
      ".confirmed{margin-top:4px;padding:12px 0;border-top:1px solid " + c.hairline +
      ";font-size:13px;line-height:1.45;color:" + c.ink + "}" +
      // Text control, not a filled button: it is the quieter of the two actions
      // in the reopened state. UA button styling cleared explicitly.
      ".textbtn{display:block;width:100%;margin-top:10px;padding:6px 0;background:none;border:0;" +
      "font-size:13px;line-height:1.45;color:" + c.muted + ";cursor:pointer;text-align:center}" +
      ".textbtn:hover{text-decoration:underline}" +
      // Attribution footer, outside .body so it renders under both the receipt
      // and the picker. The body's own 24px bottom padding is the space above.
      ".pwr{padding:0 24px 20px;text-align:center;font-size:11px;font-weight:400;" +
      "color:" + c.muted + ";line-height:1.4}" +
      // The wordmark treatment, named here because injected JS cannot reach
      // components/BlissWordmark.tsx: ALWAYS Georgia bold, in amethyst. The
      // family must be stated explicitly — baseCss points everything at the
      // sampled host font, and this rule outranks that `*` selector.
      ".pwr .wm{font-family:Georgia,serif;font-weight:700;color:" + c.amethyst + "}" +
      // Below the phone breakpoint the modal becomes a bottom sheet.
      "@media (max-width:420px){.scrim{align-items:flex-end;padding:0}" +
      ".bliss-card{width:100%;max-width:100%;max-height:88vh;border-radius:" + b.radiusCard + " " + b.radiusCard + " 0 0}}"
    );
  }

  // -------------------------------------------------------------------------
  // PLAN MATH PER TRIGGER — unchanged from both siblings
  // -------------------------------------------------------------------------

  /**
   * The check-in is passed in rather than read off state.dl, because the two
   * surfaces get it from different places: a rate card from the URL hash, the
   * checkout block from the Trip Summary card's own date range. On the booking
   * route the hash carries a cart id, so a shared read would plan the checkout
   * block against nothing.
   */
  function computeFor(amountCents, checkinDate) {
    var amount = amountCents == null ? 0 : amountCents;
    var checkin = checkinDate || (state.dl ? state.dl.checkin : null);
    if (checkin == null || amountCents == null) {
      return ineligible("invalid_input", 0, 0, amount, amount);
    }
    return previewEligibility(startOfToday(), checkin, amount, CONFIG.rules);
  }

  function defaultSelected(preview) {
    if (!preview || !preview.options.length) return null;
    for (var i = 0; i < preview.options.length; i++) {
      if (preview.options[i].recommended) return preview.options[i].frequency;
    }
    return preview.options[0].frequency;
  }

  function optionByFrequency(preview, frequency) {
    if (!preview) return null;
    for (var i = 0; i < preview.options.length; i++) {
      if (preview.options[i].frequency === frequency) return preview.options[i];
    }
    return null;
  }

  /**
   * The teaser figure on the closed trigger.
   *
   * Rate cards quote a per-night teaser off the card's own nightly rate, divided
   * by the payment count that yields the SMALLEST per-payment figure — biweekly
   * where offered, otherwise whichever eligible option has the most payments.
   * That is what makes the teaser claim truthful: no other cadence produces a
   * lower number.
   *
   * THE ONE PLACE THIS FILE IS BETTER THAN ITS SIBLINGS. Both of them carry a
   * documented known issue: the teaser divides a SCRAPED, tax-exclusive nightly
   * price while the modal quotes off a differently-derived stay total, so the
   * two do not reconcile and a guest who multiplies gets a different number.
   * Here both numbers come from the same dataLayer item and go through the same
   * withFee(), so teaser x nights x payments lands exactly on the modal's total.
   * There is nothing to reconcile.
   */
  function fromLine(t) {
    var preview = t.preview;
    if (!preview || !preview.eligible || !preview.options.length) return null;
    var opt = optionByFrequency(preview, "monthly");
    if (!opt) {
      opt = preview.options[0];
      for (var i = 1; i < preview.options.length; i++) {
        if (preview.options[i].perPaymentAmountCents < opt.perPaymentAmountCents) opt = preview.options[i];
      }
    }

    // ONE LINE, BOTH SURFACES. The guard is the per-night figure, not the kind:
    // a rate card derives it from the dataLayer or the card's own price, the
    // checkout block derives it from the tax-inclusive Total over the night
    // count (see applyDetailsAmount). Once either has produced one, the teaser
    // is computed and worded identically, because it is the same teaser.
    if (t.nightlyAmountCents != null) {
      var spread = optionByFrequency(preview, "biweekly");
      if (!spread) {
        spread = preview.options[0];
        for (var j = 1; j < preview.options.length; j++) {
          if (preview.options[j].numPayments > spread.numPayments) spread = preview.options[j];
        }
      }
      var perNight = Math.round(t.nightlyAmountCents / spread.numPayments);
      return "or " + money(perNight, cur(t)) + "/night over time";
    }

    var unit = opt.frequency === "monthly" ? "/mo" : " every 2 weeks";
    return "from " + money(opt.perPaymentAmountCents, cur(t)) + unit;
  }

  /**
   * The teaser's supporting line.
   *
   * Both siblings hardcode "Pre-tax · No credit check" on a rate card, because
   * on those engines the tax basis was established empirically. Nothing
   * establishes it on Olive, so the claim is omitted until
   * CONFIG.rateCards.priceIsTaxExclusive says otherwise. Stating a tax basis we
   * have not checked would be the one kind of wrong a demo cannot survive.
   */
  function supportingLine(t) {
    // The checkout basis INCLUDES tax, so the "Pre-tax" qualifier can never be
    // true there however CONFIG.rateCards.priceIsTaxExclusive is set. Same
    // split both siblings carry between their two surfaces.
    if (t && t.kind === "details") return "No credit check";
    return CONFIG.rateCards.priceIsTaxExclusive === true
      ? "Pre-tax · No credit check"
      : "No credit check";
  }

  /** The modal's fine-print line, on the same evidence rule as above. */
  function basisLine(t) {
    // THE FEE IS ONLY MENTIONED WHEN THERE IS ONE. At the zero rate withFee
    // adds nothing to either basis, so naming a processing fee here would
    // describe a charge the guest is not being asked to pay. Both branches
    // read the same rate, so neither can claim a fee the other has dropped.
    var hasFee = feeRate() > 0;
    // The two surfaces quote different bases, so the fine print follows the
    // basis rather than being one string. Same split both siblings carry.
    if (t && t.kind === "details") return hasFee ? "Tax and processing fee included" : "Tax included";
    var fee = hasFee ? "Includes the " + Math.round(feeRate() * 100) + "% processing fee" : null;
    var tax = CONFIG.rateCards.priceIsTaxExclusive === true ? "Pre-tax" : "Based on the rate shown on this page";
    return fee ? tax + " · " + fee : tax;
  }

  // -------------------------------------------------------------------------
  // TRIGGER — markup and copy unchanged from both siblings
  // -------------------------------------------------------------------------

  /** "start"/"end" are writing-mode relative; the shadow root needs a side. */
  function normalizeAlign(v) {
    var s = String(v || "").trim();
    if (s === "start") return "left";
    if (s === "end") return "right";
    if (s === "left" || s === "right" || s === "center" || s === "justify") return s;
    return "left";
  }

  // One-shot, so the per-mutation sync cannot spam. Reports both the sampled
  // font and the one actually applied, which is how a sampler regression
  // (Times against a sans-serif host) becomes visible instead of just looking
  // slightly wrong.
  var reportedFont = false;

  function reportTeaserFont(face) {
    if (reportedFont) return;
    reportedFont = true;
    console.info(
      "[bliss] teaser typography — sampled theme.font: " +
        JSON.stringify(state.theme && state.theme.font) +
        "  |  applied, read off the anchor: " +
        JSON.stringify(face)
    );
  }

  function renderTrigger(t) {
    if (!state.theme || !t.root) return;
    var h = domFor(t.hostEl.ownerDocument);
    var root = t.root;
    root.innerHTML = "";
    root.appendChild(h("style", { text: triggerCss(state.theme) }));

    // :host{all:initial} severs inheritance, so the teaser cannot pick up the
    // host font on its own. Read family AND text-align off the line the teaser
    // was inserted after — the card's own conditions line — so the teaser sits
    // in that line's typography and tracks its alignment. Emitted after the
    // main sheet so it overrides baseCss's *{font-family:...}.
    //
    // Size and weight are deliberately NOT sampled: on Ayres that produced a
    // 16px/600 display scale in a row of small labels. triggerCss sets them.
    var face = null;
    try {
      var ref = (t.anchorEl && t.anchorEl.isConnected && t.anchorEl) || t.hostEl.parentNode;
      if (ref && ref.nodeType === 1) {
        var rcs = ownerWin(ref).getComputedStyle(ref);
        face = { family: rcs.fontFamily, align: rcs.textAlign };
      }
    } catch (e) {
      face = null;
    }
    if (face && face.family) {
      root.appendChild(
        h("style", {
          text:
            "*{font-family:" + face.family + "}" +
            ".trig,.trig .sub{text-align:" + normalizeAlign(face.align) + "}",
        })
      );
    }
    reportTeaserFont(face);

    var kids;
    var cOpt = confirmedOption(t);
    if (cOpt) {
      // The count and the per-payment amount are deliberately not on this line:
      // the modal already states them, and it is one click away.
      kids = [h("span", { class: "tick", text: "✓" }), h("span", { text: "Payment plan selected" })];
    } else {
      var line = fromLine(t);
      if (!line) {
        // Nothing worth showing. Stay invisible rather than explain ourselves
        // on top of the host page. The checkout surface says WHY in the console,
        // because a silent hide there was a round trip to diagnose.
        if (t.kind === "details") reportDetailsSuppressed(t);
        t.hostEl.style.display = "none";
        return;
      }
      kids = [
        h("span", { class: "amt", text: line }),
        h("span", { class: "sub", text: supportingLine(t) }),
      ];
    }
    root.appendChild(
      h(
        "button",
        {
          class: "trig",
          type: "button",
          "aria-haspopup": "dialog",
          onClick: function (ev) {
            ev.preventDefault();
            ev.stopPropagation(); // a rate card is usually itself clickable
            openModal(t.id);
          },
        },
        kids
      )
    );

    // Re-size against the parent's CURRENT layout, then check the result. The
    // card can re-render into a different layout between attach and render, and
    // the host must track it rather than keep whatever it was born with.
    if (t.hostEl.parentElement) {
      styleInlinePill(
        t.hostEl,
        t.hostEl.parentElement,
        t.kind === "details" ? CONFIG.detailsStep.marginTopPx : null
      );
    }
    t.hostEl.style.display = "block";
    verifyTeaserBox(t);
  }

  function renderAllTriggers() {
    state.triggers.slice().forEach(renderTrigger);
  }

  // -------------------------------------------------------------------------
  // MODAL — unchanged from both siblings
  // -------------------------------------------------------------------------

  var modalHostEl = null;
  var modalRoot = null;

  function ensureModalHost() {
    if (!document.body) return;
    if (modalHostEl && modalHostEl.isConnected) return;
    if (modalHostEl && modalHostEl.parentNode) modalHostEl.parentNode.removeChild(modalHostEl);
    modalHostEl = document.createElement("div");
    modalHostEl.id = MODAL_HOST_ID;
    modalHostEl.style.position = "fixed";
    modalHostEl.style.top = "0";
    modalHostEl.style.right = "0";
    modalHostEl.style.bottom = "0";
    modalHostEl.style.left = "0";
    modalHostEl.style.zIndex = "2147483647";
    modalHostEl.style.display = "none";
    modalRoot = modalHostEl.attachShadow({ mode: "open" });
    document.body.appendChild(modalHostEl);
  }

  function triggerById(id) {
    for (var i = 0; i < state.triggers.length; i++) {
      if (state.triggers[i].id === id) return state.triggers[i];
    }
    return null;
  }

  function onKeydown(ev) {
    if (ev.key === "Escape" && state.modal) {
      ev.stopPropagation();
      closeModal();
    }
  }

  var keydownBound = false;

  function bindKeydown() {
    if (keydownBound) return;
    try {
      document.addEventListener("keydown", onKeydown, true);
      keydownBound = true;
    } catch (e) {
      /* ignore */
    }
  }

  function unbindKeydown() {
    if (!keydownBound) return;
    try {
      document.removeEventListener("keydown", onKeydown, true);
    } catch (e) {
      /* ignore */
    }
    keydownBound = false;
  }

  function openModal(triggerId) {
    var t = triggerById(triggerId);
    if (!t) return;
    // justConfirmed is per modal SESSION, unlike t.confirmed which is per stay:
    // it is what distinguishes the state right after clicking Select this plan
    // from reopening a modal whose plan was already chosen. A fresh open always
    // starts false, so a reopen lands on the reopened state.
    state.modal = {
      triggerId: triggerId,
      selected: defaultSelected(t.preview),
      justConfirmed: false,
    };
    ensureModalHost();
    if (!modalHostEl) return;
    modalHostEl.style.display = "block";
    bindKeydown();
    renderModal();
  }

  function closeModal() {
    state.modal = null;
    unbindKeydown();
    if (modalHostEl) {
      modalHostEl.style.display = "none";
      if (modalRoot) modalRoot.innerHTML = "";
    }
  }

  function renderModal() {
    if (!state.modal || !modalRoot) return;
    var t = triggerById(state.modal.triggerId);
    if (!t) {
      closeModal();
      return;
    }
    var theme = state.theme;
    var preview = t.preview;
    var currency = cur(t);
    var doc = modalHostEl.ownerDocument;
    var h = domFor(doc);

    modalRoot.innerHTML = "";
    modalRoot.appendChild(h("style", { text: modalCss(theme) }));

    var head = h("div", { class: "head" }, [
      h("div", {}, [
        h("h2", { text: "Spread this stay over time" }),
        h("p", { text: t.label || (state.dl && state.dl.hotelName) || "Payment plan" }),
      ]),
      h("button", { class: "x", "aria-label": "Close", type: "button", onClick: closeModal, text: "×" }),
    ]);

    var body = h("div", { class: "body" });

    var ctxBits = [];
    // The checkout block's stay comes from the Trip Summary card, not the hash.
    var ctxIn = t.kind === "details" && t.checkin ? formatDate(t.checkin) : state.dl && state.dl.checkinIso;
    var ctxNights = t.kind === "details" ? t.nights : state.dl && state.dl.nights;
    if (ctxIn) ctxBits.push(shortDate(ctxIn));
    if (ctxNights != null && ctxNights > 0) {
      ctxBits.push(ctxNights + (ctxNights === 1 ? " night" : " nights"));
    }
    if (t.amountCents != null) ctxBits.push(money(t.amountCents, currency));
    body.appendChild(h("div", { class: "ctx", text: ctxBits.join(" · ") || "Waiting for dates" }));
    body.appendChild(h("div", { class: "fine", text: basisLine(t) }));

    if (!preview || !preview.eligible) {
      var reason = preview ? preview.reason : "invalid_input";
      body.appendChild(h("div", { class: "msg", text: REASON_COPY[reason] || REASON_COPY.invalid_input }));
      mountModalCard(h, head, body);
      return;
    }

    // Confirmed: the modal becomes a receipt. Everything the guest used to make
    // the decision is dropped rather than left for them to re-read.
    var confirmedOpt = confirmedOption(t);
    if (confirmedOpt) {
      var reopened = !state.modal.justConfirmed;
      body.appendChild(h("div", { class: "plan", text: planSummary(confirmedOpt, currency) }));
      body.appendChild(
        h("div", {
          class: "confirmed",
          text: reopened
            ? "You selected the " + planLabel(confirmedOpt.frequency) + " plan. Continue to checkout to finish."
            : "Plan selected. Continue to checkout and pay with your card as usual.",
        })
      );
      body.appendChild(h("button", { class: "cta", type: "button", text: "Back to booking", onClick: closeModal }));
      if (reopened) {
        body.appendChild(
          h("button", {
            class: "textbtn",
            type: "button",
            text: "Cancel plan",
            onClick: function () {
              // Clears the CONFIRMATION only, not the selection. clearSelection
              // would drop both and leave State 1 with no row selected and a
              // disabled button, which is a dead end for the guest.
              state.planChoice = null;
              state.triggers.forEach(function (x) {
                x.confirmed = null;
              });
              state.modal.justConfirmed = false;
              recompute();
              renderAllTriggers();
              renderModal();
            },
          })
        );
      }
      mountModalCard(h, head, body);
      return;
    }

    if (preview.depositAmountCents > 0) {
      body.appendChild(
        h("div", {
          class: "ctx",
          text: money(preview.depositAmountCents, currency) + " today, then the balance on the schedule below.",
        })
      );
    }

    preview.options.forEach(function (opt) {
      var isSel = state.modal.selected === opt.frequency;
      var lbl = h("div", {}, [
        h("div", { class: "lbl" }, []),
        h("div", {
          class: "sub",
          text:
            opt.numPayments +
            (opt.numPayments === 1 ? " payment" : " payments") +
            " through " +
            shortDate(opt.dueDates[opt.dueDates.length - 1]),
        }),
      ]);
      lbl.firstChild.appendChild(doc.createTextNode(opt.frequency === "biweekly" ? "Every 2 weeks" : "Monthly"));
      if (opt.recommended) lbl.firstChild.appendChild(h("span", { class: "tag", text: "Recommended" }));

      body.appendChild(
        h(
          "button",
          {
            class: "opt",
            type: "button",
            "aria-pressed": isSel ? "true" : "false",
            onClick: function () {
              // Clicking the already-selected row toggles it off rather than
              // being a no-op, so a guest can back out of a plan entirely.
              if (isSel) {
                clearSelection(t);
                return;
              }
              // Changing the plan un-confirms it, so the button comes back and
              // the guest can select the row they just moved to.
              if (t.confirmed || state.planChoice) {
                state.planChoice = null;
                state.triggers.forEach(function (x) {
                  x.confirmed = null;
                });
                state.modal.justConfirmed = false;
                renderAllTriggers();
              }
              state.modal.selected = opt.frequency;
              renderModal();
            },
          },
          [
            lbl,
            h("div", { class: "amt" }, [
              h("b", { text: money(opt.perPaymentAmountCents, currency) }),
              h("span", { text: "per payment" }),
            ]),
          ]
        )
      );
    });

    var chosen = optionByFrequency(preview, state.modal.selected);

    // Payment schedule, collapsed by default. Reads the dates and amounts
    // previewEligibility already produced — nothing is recomputed here, so the
    // rows cannot drift from the per-payment figure shown on the option above.
    if (chosen) {
      body.appendChild(
        h("button", {
          class: "disc",
          type: "button",
          "aria-expanded": state.modal.scheduleOpen ? "true" : "false",
          text: (state.modal.scheduleOpen ? "▾" : "▸") + "  Payment schedule",
          onClick: function () {
            state.modal.scheduleOpen = !state.modal.scheduleOpen;
            renderModal();
          },
        })
      );
      if (state.modal.scheduleOpen) {
        var rows = h("div", { class: "sched" });
        chosen.dueDates.forEach(function (iso, i) {
          var last = i === chosen.dueDates.length - 1;
          rows.appendChild(
            h("div", { class: "row" }, [
              h("span", { class: "n", text: String(i + 1) }),
              h("span", { class: "d", text: shortDate(iso) }),
              h("span", {
                class: "v",
                text: money(last ? chosen.finalPaymentAmountCents : chosen.perPaymentAmountCents, currency),
              }),
            ])
          );
        });
        body.appendChild(rows);
      }
    }

    // Plan terms, collapsed by default. Built as the schedule disclosure above
    // is, down to the caret and the toggle, so the two are one pattern used
    // twice. Its own flag, so opening either leaves the other as it was.
    //
    // Not gated on `chosen`, unlike the schedule: the terms describe the plan
    // rather than the selected cadence, so they stay readable when the guest
    // has deselected and the schedule has nothing to show.
    body.appendChild(
      h("button", {
        class: "disc",
        type: "button",
        "aria-expanded": state.modal.termsOpen ? "true" : "false",
        text: (state.modal.termsOpen ? "▾" : "▸") + "  Plan terms and conditions",
        onClick: function () {
          state.modal.termsOpen = !state.modal.termsOpen;
          renderModal();
        },
      })
    );
    if (state.modal.termsOpen) {
      var terms = h("div", { class: "terms" });
      PLAN_TERMS_LINES.forEach(function (line) {
        terms.appendChild(h("div", { class: "row", text: line }));
      });
      body.appendChild(terms);
    }

    // State 1 tail: the action, then the note. The confirmed states never reach
    // here — they return a receipt body above.
    body.appendChild(
      h("button", {
        class: "cta",
        type: "button",
        text: chosen ? "Select this plan" : "Continue with this plan",
        disabled: chosen ? null : "disabled",
        onClick: function () {
          // Re-resolve at click time rather than trusting the option captured
          // when this button was built. `disabled` is advisory — anything that
          // mutates the selection without a re-render would leave a stale
          // closure able to confirm a plan the guest is no longer looking at.
          var live = state.modal ? optionByFrequency(t.preview, state.modal.selected) : null;
          if (live) confirmPlan(t, live);
        },
      })
    );
    body.appendChild(h("div", { class: "note", text: "Choose your plan and finish checkout as usual." }));

    mountModalCard(h, head, body);
  }

  /**
   * Backs a trigger all the way out of a plan: drops the modal's selection and
   * the recorded confirmation together, so the modal returns to its unselected
   * state and the trigger reverts to its teaser text.
   */
  function clearSelection(t) {
    if (state.modal) state.modal.selected = null;
    // One plan per stay, so cancelling clears it everywhere.
    state.planChoice = null;
    state.triggers.forEach(function (x) {
      x.confirmed = null;
    });
    recompute();
    renderAllTriggers();
    renderModal();
  }

  function mountModalCard(h, head, body) {
    // Attribution. Built here rather than in either render path, so it lands
    // under the receipt state and the picker state alike — both mount through
    // this one function. `text` is applied before kids are appended, so the
    // label sits ahead of the wordmark span.
    var pwr = h("div", { class: "pwr", text: "Powered by " }, [h("span", { class: "wm", text: "Bliss" })]);
    var card = h("div", { class: "bliss-card", role: "dialog", "aria-modal": "true", tabindex: "-1" }, [
      head,
      body,
      pwr,
    ]);
    card.addEventListener("click", function (ev) {
      ev.stopPropagation();
    });
    var scrim = h("div", { class: "scrim", onClick: closeModal }, [card]);
    modalRoot.appendChild(scrim);
    try {
      card.focus();
    } catch (e) {
      /* ignore */
    }
  }

  /**
   * The receipt line: the same three facts the option row carried — cadence,
   * count and per-payment amount — plus the final due date it showed, stated
   * once instead of side by side with the alternative.
   */
  function planSummary(option, currency) {
    var last = option.dueDates[option.dueDates.length - 1];
    return (
      planLabel(option.frequency) +
      ", " +
      option.numPayments +
      (option.numPayments === 1 ? " payment of " : " payments of ") +
      money(option.perPaymentAmountCents, currency) +
      " through " +
      shortDate(last)
    );
  }

  /** The option row's own wording, so the confirmation names what was clicked. */
  function planLabel(frequency) {
    return frequency === "biweekly" ? "Every 2 weeks" : "Monthly";
  }

  /**
   * The live option backing a confirmation, resolved against the CURRENT
   * preview. Confirmations deliberately store no amount: only the frequency is
   * durable, and every figure is derived at render. That is what lets a date
   * change flow through a confirmed plan instead of freezing it.
   */
  function confirmedOption(t) {
    if (!t || !t.confirmed || !t.preview) return null;
    return optionByFrequency(t.preview, t.confirmed.frequency);
  }

  function confirmPlan(t, option) {
    // Frequency and count only — no amount. See confirmedOption.
    //
    // cardKey rides along so recompute can put the confirmation back on the
    // card it was made on after a re-render destroys this trigger.
    t.confirmed = {
      frequency: option.frequency,
      numPayments: option.numPayments,
      cardKey: t.cardKey || null,
    };
    var choice = {
      frequency: option.frequency,
      numPayments: option.numPayments,
      perPaymentAmountCents: option.perPaymentAmountCents,
      finalPaymentAmountCents: option.finalPaymentAmountCents,
      dueDates: option.dueDates.slice(),
      depositAmountCents: t.preview ? t.preview.depositAmountCents : 0,
      amountCents: t.amountCents,
      nightlyAmountCents: t.nightlyAmountCents,
      currency: cur(t),
      source: t.kind, // "rate-card"
      amountSource: t.amountSource, // "dataLayer"
      rateId: t.rateId || null,
      rateName: t.rateName || t.label || null,
      checkin: t.kind === "details" && t.checkin ? formatDate(t.checkin) : state.dl ? state.dl.checkinIso : null,
      checkout: t.kind === "details" && t.checkout ? formatDate(t.checkout) : state.dl ? state.dl.checkoutIso : null,
      nights: t.kind === "details" ? t.nights : state.dl ? state.dl.nights : null,
      hotelId: state.dl ? state.dl.hotelId : null,
      hotelName: state.dl ? state.dl.hotelName : null,
      itemName: state.dl ? state.dl.itemName : null,
      itemVariant: state.dl ? state.dl.itemVariant : null,
      merchantSlug: CONFIG.merchantSlug,
      selectedAt: new Date().toISOString(),
    };
    // Record only. No card capture, no network, no interference with checkout.
    try {
      window.__blissPlanChoice = choice;
    } catch (e) {
      /* ignore */
    }
    try {
      window.dispatchEvent(new CustomEvent("bliss:plan-selected", { detail: choice }));
    } catch (e) {
      /* ignore */
    }
    console.log("[bliss] plan selected", choice);
    // Session-level, so the choice survives a re-render that destroys this
    // trigger and is restored onto the same card by recompute.
    state.planChoice = t.confirmed;
    if (state.modal) state.modal.justConfirmed = true;
    renderAllTriggers();
    if (CONFIG.closeModalOnConfirm) closeModal();
    else renderModal();
  }

  // =========================================================================
  // CHECKOUT STEP — the Trip Summary card
  //
  // Ported from ayres-overlay.js detailsStep, which is the reference for this
  // whole shape: a label-anchored total, a forward scan to assemble the amount
  // across fragmented text nodes, placement relative to the total ROW rather
  // than the money node, one block only, and a mount that survives a re-render.
  //
  // WHAT IS DIFFERENT HERE. Ayres reads its nights from a date control it has
  // to hunt for across the page. Olive puts the stay in the summary card
  // itself, and the URL hash on this route carries a cart id rather than dates,
  // so the card is the ONLY source: parseSummaryDates reads it and the hash is
  // not consulted at all on this page.
  // =========================================================================

  var MONTHS_SRC = "jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec";
  var MONTH_INDEX = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
  };

  function monthIndex(tok) {
    var k = String(tok || "").toLowerCase().slice(0, 4);
    if (MONTH_INDEX[k] != null) return MONTH_INDEX[k];
    k = k.slice(0, 3);
    return MONTH_INDEX[k] == null ? null : MONTH_INDEX[k];
  }

  // "Dec 16 - 17", "Dec 16, 2026 - Dec 17, 2026", "Dec 30 - Jan 2".
  var RANGE_MDY = new RegExp(
    "\\b(" + MONTHS_SRC + ")[a-z]*\\.?\\s+(\\d{1,2})(?:\\s*,\\s*(\\d{4}))?" +
      "\\s*(?:-|\u2013|\u2014|to)\\s*" +
      "(?:(" + MONTHS_SRC + ")[a-z]*\\.?\\s+)?(\\d{1,2})(?:\\s*,\\s*(\\d{4}))?",
    "i"
  );
  // "16 Dec - 17 Dec"
  var RANGE_DMY = new RegExp(
    "\\b(\\d{1,2})\\s+(" + MONTHS_SRC + ")[a-z]*\\.?" +
      "\\s*(?:-|\u2013|\u2014|to)\\s*" +
      "(\\d{1,2})\\s+(" + MONTHS_SRC + ")[a-z]*\\.?",
    "i"
  );

  // Numeric fallbacks, in case a locale or a layout renders digits instead of a
  // month name. Cheap to support and they cost nothing when unused.
  var RANGE_ISO = /\b(\d{4})-(\d{2})-(\d{2})\s*(?:\u2013|\u2014|to|\u2192|-)\s*(\d{4})-(\d{2})-(\d{2})\b/;
  var RANGE_NUM = /\b(\d{1,2})[\/.](\d{1,2})(?:[\/.](\d{2,4}))?\s*(?:-|\u2013|\u2014|to)\s*(\d{1,2})[\/.](\d{1,2})(?:[\/.](\d{2,4}))?\b/;

  /** Two calendar dates to a validated stay, or null. Year inference included. */
  function buildStay(m1, d1, y1, m2, d2, y2) {
    if (m1 == null || !d1 || !d2 || d1 > 31 || d2 > 31) return null;
    var today = startOfToday();
    var ciYear = y1 != null ? y1 : today.getFullYear();
    var ci = new Date(ciYear, m1, d1);
    if (ci.getMonth() !== m1 || ci.getDate() !== d1) return null; // e.g. Feb 31
    // A stay is a future booking, so a date that lands in the past belongs to
    // next year. Only when the year was not stated.
    if (y1 == null && ci.getTime() < today.getTime()) ci = new Date(ciYear + 1, m1, d1);

    var m2i = m2 == null ? ci.getMonth() : m2;
    var coYear = y2 != null ? y2 : ci.getFullYear();
    // A named month EARLIER than the check-in month is next year, which is what
    // makes "Dec 30 - Jan 2" a three-night stay rather than a negative one.
    if (y2 == null && m2 != null && m2 < m1) coYear += 1;
    var co = new Date(coYear, m2i, d2);
    if (co.getTime() <= ci.getTime()) {
      co = m2 == null ? new Date(coYear, m2i + 1, d2) : new Date(coYear + 1, m2i, d2);
    }
    if (co.getTime() <= ci.getTime()) return null;

    var nights = daysBetween(ci, co);
    if (nights < 1 || nights > 60) return null;
    return { checkin: ci, checkout: co, nights: nights };
  }

  /**
   * One string to a stay, or a REASON it could not be one.
   *
   * The reason is the point. A parser that answers only null turns every
   * failure into a round trip; this one says which strings it looked at and
   * what was wrong with each, so the next failure is a line in the console.
   */
  function parseRangeString(s) {
    var text = String(s || "");
    if (!text) return { ok: false, why: "empty" };

    var m = RANGE_ISO.exec(text);
    if (m) {
      var iso = buildStay(Number(m[2]) - 1, Number(m[3]), Number(m[1]), Number(m[5]) - 1, Number(m[6]), Number(m[4]));
      return iso ? { ok: true, stay: iso, text: m[0], via: "ISO" } : { ok: false, why: "ISO range did not validate" };
    }

    m = RANGE_MDY.exec(text);
    if (m) {
      var a = buildStay(
        monthIndex(m[1]), Number(m[2]), m[3] ? Number(m[3]) : null,
        m[4] ? monthIndex(m[4]) : null, Number(m[5]), m[6] ? Number(m[6]) : null
      );
      return a ? { ok: true, stay: a, text: m[0], via: "month-first" }
               : { ok: false, why: 'looked like "Mon D - D" but did not validate' };
    }

    m = RANGE_DMY.exec(text);
    if (m) {
      var b = buildStay(monthIndex(m[2]), Number(m[1]), null, monthIndex(m[4]), Number(m[3]), null);
      return b ? { ok: true, stay: b, text: m[0], via: "day-first" }
               : { ok: false, why: 'looked like "D Mon - D Mon" but did not validate' };
    }

    m = RANGE_NUM.exec(text);
    if (m) {
      var y1n = m[3] ? Number(m[3]) : null;
      var y2n = m[6] ? Number(m[6]) : null;
      if (y1n != null && y1n < 100) y1n += 2000;
      if (y2n != null && y2n < 100) y2n += 2000;
      var c = buildStay(Number(m[1]) - 1, Number(m[2]), y1n, Number(m[4]) - 1, Number(m[5]), y2n);
      return c ? { ok: true, stay: c, text: m[0], via: "numeric" }
               : { ok: false, why: "numeric range did not validate" };
    }

    if (!/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(text) && !/\d/.test(text)) {
      return { ok: false, why: "no month name and no digits" };
    }
    if (!/-|\u2013|\u2014|\bto\b/.test(text)) return { ok: false, why: "no range separator (- , to)" };
    return { ok: false, why: "has a separator but no recognisable date on both sides" };
  }

  /**
   * The scopes the date range might live in, innermost first.
   *
   * TWO SCOPES, NOT ONE. The markers that identify the summary ("Nightly Rate",
   * "Taxes and Fees", "Total") commonly sit in a rows container, while the room
   * name and the date line sit above it as siblings inside the outer card.
   * Resolving a single element for both is exactly what made this render
   * nothing on the live page: isSummaryCard settled on the rows container,
   * whose text is "Nightly Rate $299.00 Taxes and Fees $49.61 Free cancellation
   * until Dec 14 Total $348.61" — no range in it, so the parse returned null and
   * the block hid itself. Climbing outward finds the card that holds both.
   */
  function dateScopes(summary) {
    var out = [];
    var node = summary;
    for (var d = 0; node && node.nodeType === 1 && d <= CONFIG.detailsStep.dateScopeClimbMax; d++) {
      out.push(node);
      if (node === document.body || node === document.documentElement) break;
      node = node.parentNode;
    }
    return out;
  }

  /**
   * Every string worth trying, shortest first.
   *
   * Shortest first so the date line itself wins over the whole card's text: a
   * tight match is both more likely to be right and far more legible in the log
   * than a 300-character blob. The " | 2 Guests" suffix needs no special
   * handling — the range regexes are unanchored, so trailing text after the
   * second day is simply not consumed.
   */
  function dateCandidates(scope) {
    var cfg = CONFIG.detailsStep;
    var seen = {};
    var out = [];
    function add(s) {
      var t = String(s || "").replace(/\s+/g, " ").trim();
      if (!t || t.length > cfg.maxDateCandidateLength) return;
      if (seen[t]) return;
      seen[t] = 1;
      out.push(t);
    }
    var all;
    try {
      all = scope.querySelectorAll("*");
    } catch (e) {
      all = [];
    }
    for (var i = 0; i < all.length; i++) {
      if (isOurNode(all[i])) continue;
      add(normText(all[i]));
    }
    add(normText(scope));
    out.sort(function (a, b) {
      return a.length - b.length;
    });
    return out;
  }

  /**
   * The stay, parsed out of the Trip Summary card's own date range.
   *
   * THE HASH IS NOT CONSULTED ON THIS PAGE. On the booking route the hash
   * carries a cart id, not dates, and whatever dates it does carry may be stale
   * against the summary. The card is what the guest is looking at, so the card
   * is the source.
   *
   * Returns the stay, or a record of every string examined and why each was
   * rejected, so a failure is diagnosable from the console alone.
   */
  function parseSummaryDates(summary) {
    if (!summary) return null;
    var scopes = dateScopes(summary);
    var examined = [];
    // Deduped ACROSS scopes: each outer scope re-yields every string the inner
    // one already offered, and without this the log is the same dozen amounts
    // repeated four times with the one interesting line pushed off the end.
    var seenExamined = {};
    for (var s = 0; s < scopes.length; s++) {
      var cands = dateCandidates(scopes[s]);
      for (var i = 0; i < cands.length; i++) {
        if (seenExamined[cands[i]]) continue;
        seenExamined[cands[i]] = 1;
        var r = parseRangeString(cands[i]);
        if (r.ok) {
          return {
            checkin: r.stay.checkin,
            checkout: r.stay.checkout,
            nights: r.stay.nights,
            text: r.text,
            via: r.via,
            scope: s,
            candidate: cands[i],
          };
        }
        examined.push({ text: cands[i], why: r.why });
      }
    }
    lastDateFailure = examined;
    return null;
  }

  /** What the last failed parse looked at, for the diagnostic. */
  var lastDateFailure = null;

  /** Every text node in an element, with its parent tag. For the diagnostic. */
  function dumpTextNodes(el, max) {
    var out = [];
    if (!el) return out;
    try {
      var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
      var n;
      while ((n = walker.nextNode())) {
        if (out.length >= (max || 60)) break;
        var t = String(n.nodeValue || "").replace(/\s+/g, " ").trim();
        if (!t) continue;
        var parent = n.parentNode;
        if (parent && isOurNode(parent)) continue;
        var cls = "";
        if (parent && parent.nodeType === 1) {
          var c = typeof parent.className === "string" ? parent.className.trim().split(/\s+/)[0] : "";
          cls = parent.tagName.toLowerCase() + (c ? "." + c : "");
        }
        out.push({ parent: cls, text: t });
      }
    } catch (e) {
      /* a diagnostic must never break the thing it is diagnosing */
    }
    return out;
  }

  /**
   * The amount that follows a LABEL element, as integer cents.
   *
   * Two passes, widening only when the narrow one comes up empty:
   *   1. the label's following siblings, concatenated in order
   *   2. the label's ancestors, taking only the text AFTER the label phrase
   *
   * Pass 2 covers the case where the symbol and the digits are not siblings of
   * the label but cousins under a shared wrapper. Ported verbatim in shape from
   * ayres-overlay.js, because the checkout panel fragments its amounts exactly
   * the same way: "$" and "348.61" are separate text nodes, so a regex on the
   * row's own element finds nothing.
   */
  function assembleAmountAfterLabel(labelEl, labelInlineRe) {
    if (!labelEl) return null;
    var re = CONFIG.rateCards.amountRe;
    var buf = "";
    var sib = labelEl.nextElementSibling;
    for (var n = 0; sib && n < 12; n++) {
      buf += " " + normText(sib);
      var m = re.exec(buf);
      if (m) return { cents: parseMoneyTextToCents(m[0]), text: m[0] };
      sib = sib.nextElementSibling;
    }
    var node = labelEl;
    for (var d = 0; d < 5; d++) {
      var parent = node.parentNode;
      if (!parent || parent.nodeType !== 1) break;
      var whole = normText(parent);
      var split = labelInlineRe.exec(whole);
      if (split) {
        var after = whole.slice(split.index + split[0].length);
        var mm = re.exec(after);
        if (mm) return { cents: parseMoneyTextToCents(mm[0]), text: mm[0] };
      }
      node = parent;
    }
    return null;
  }

  /** Is this element the Trip Summary card? Both markers required. */
  function isSummaryCard(el) {
    var text = normText(el);
    if (!text || text.length > 4000) return false;
    var marks = CONFIG.detailsStep.summaryMarkersRe;
    for (var i = 0; i < marks.length; i++) if (!marks[i].test(text)) return false;
    return true;
  }

  /**
   * The checkout anchor: the Total label, its row, and the summary card it sits
   * in. Null on any page that is not the checkout step, which is what gates the
   * two modes apart — see sync.
   *
   * Candidates are leaves whose OWN text is exactly "Total". "Nightly Rate" and
   * "Taxes and Fees" render amounts in this same card and are deliberately not
   * anchors; anchoring on either would write the plan against a pre-tax figure.
   */
  function resolveCheckoutAnchor() {
    var cfg = CONFIG.detailsStep;
    var all;
    try {
      all = document.querySelectorAll("*");
    } catch (e) {
      return null;
    }

    var labels = [];
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el.children && el.children.length) continue;
      if (isOurNode(el)) continue;
      var t = normText(el);
      if (!t || t.length > 40) continue;
      var exact = cfg.totalLabelRe.test(t);
      // The combined-cell fallback: "Total $348.61" in one element.
      var inline = !exact && cfg.totalInlineRe.test(t) && CONFIG.rateCards.amountRe.test(t);
      if (!exact && !inline) continue;
      if (!hasBox(el)) continue;
      labels.push({ el: el, inline: inline });
    }
    if (!labels.length) return null;

    for (var k = 0; k < labels.length; k++) {
      var label = labels[k].el;
      var summary = null;
      var node = label;
      for (var d = 0; d < cfg.summaryClimbMax && node; d++) {
        node = node.parentNode;
        if (!node || node.nodeType !== 1) break;
        if (node === document.body) break;
        if (isSummaryCard(node)) {
          summary = node;
          break;
        }
      }
      if (!summary) continue;

      // The ROW: the smallest ancestor that holds the label AND an amount, so
      // the block lands under the whole row rather than between the word
      // "Total" and its figure.
      var row = null;
      var r = label;
      for (var q = 0; q < cfg.rowClimbMax && r; q++) {
        var rt = normText(r);
        if (CONFIG.rateCards.amountRe.test(rt) && hasBox(r) && r !== summary) {
          row = r;
          break;
        }
        r = r.parentNode;
        if (!r || r.nodeType !== 1 || r === summary) break;
      }
      if (!row) row = label.parentNode && label.parentNode.nodeType === 1 ? label.parentNode : label;
      return { label: label, row: row, summary: summary, inline: labels[k].inline };
    }
    return null;
  }

  /** The tax-inclusive Total, in integer cents. Never the nightly subtotal. */
  function scrapeDetailsTotalCents(anchor) {
    if (!anchor) return null;
    var cfg = CONFIG.detailsStep;
    if (anchor.inline) {
      // Label and amount in one element: split on the word, read what follows.
      var whole = normText(anchor.label);
      var s = cfg.totalLabelInlineRe.exec(whole);
      if (s) {
        var mm = CONFIG.rateCards.amountRe.exec(whole.slice(s.index + s[0].length));
        if (mm) return parseMoneyTextToCents(mm[0]);
      }
      return parseMoneyTextToCents(whole);
    }
    var got = assembleAmountAfterLabel(anchor.label, cfg.totalLabelInlineRe);
    return got ? got.cents : null;
  }

  // Displays whose CHILDREN cannot be an arbitrary block-level element. A <div>
  // dropped between two <tr>s is not table content: the browser wraps it in an
  // anonymous cell or gives it no box, which is the classic "inserted, rendered
  // and invisible" failure. Ported from ayres-overlay.js.
  var NO_BLOCK_CHILDREN = {
    table: 1, "table-row": 1, "table-row-group": 1, "table-header-group": 1,
    "table-footer-group": 1, "table-cell": 1, "table-column": 1,
    "table-column-group": 1, "table-caption": 1, "inline-table": 1,
    ruby: 1, "ruby-text": 1,
  };

  function displayOf(el) {
    try {
      return String(ownerWin(el).getComputedStyle(el).display || "");
    } catch (e) {
      return "";
    }
  }

  /** Where the block is inserted, given the total row. */
  function chooseDetailsSlot(row) {
    // A CELL CAN HOLD A BLOCK, so go inside it rather than climbing out of the
    // table: walking out returns the <table>, which puts the block below every
    // row in it rather than under the Total.
    if (displayOf(row) === "table-cell") return { el: row, mode: "inside" };
    var node = row;
    for (var d = 0; d < 3; d++) {
      var parent = node.parentNode;
      if (!parent || parent.nodeType !== 1) break;
      if (!NO_BLOCK_CHILDREN[displayOf(parent)]) break;
      node = parent;
    }
    return { el: node, mode: "after" };
  }

  var DETAILS_ATTR = "data-bliss-details";

  function detailsTrigger() {
    for (var i = 0; i < state.triggers.length; i++) {
      if (state.triggers[i].kind === "details") return state.triggers[i];
    }
    return null;
  }

  /** Takes the block off the page and forgets it. */
  function dropDetailsTrigger() {
    var t = detailsTrigger();
    // Sweep by attribute as well as by state, so a block left by an earlier
    // paste is removed even though this instance never tracked it.
    var strays;
    try {
      strays = document.querySelectorAll("[" + DETAILS_ATTR + "]");
    } catch (e) {
      strays = [];
    }
    for (var s = 0; s < strays.length; s++) {
      if (strays[s].parentNode) strays[s].parentNode.removeChild(strays[s]);
    }
    if (!t) return;
    if (state.modal && state.modal.triggerId === t.id) closeModal();
    state.triggers = state.triggers.filter(function (x) {
      return x !== t;
    });
  }

  /**
   * Mounts the checkout block immediately after the Total row, or leaves the
   * existing one alone when it is still where it belongs.
   *
   * ONE BLOCK ONLY, BY CONSTRUCTION. Every block on the page is swept at the
   * one point where a new one is about to be created, tracked or not, so a
   * second paste REPLACES rather than adds. Sparing the tracked host and
   * returning early on it is what left two blocks on the page in
   * ayres-overlay.js, and the sweep is where that was fixed.
   */
  function ensureDetailsTrigger(anchor) {
    var cfg = CONFIG.detailsStep;
    var slot = chooseDetailsSlot(anchor.row);
    var existing = detailsTrigger();

    // Still mounted in the right place against the same row: nothing to do.
    if (
      existing &&
      existing.hostEl.isConnected &&
      existing.rowEl === anchor.row &&
      existing.slotEl === slot.el
    ) {
      existing.anchorInfo = anchor;
      return;
    }

    var strays;
    try {
      strays = document.querySelectorAll("[" + DETAILS_ATTR + "]");
    } catch (e) {
      strays = [];
    }
    for (var s = 0; s < strays.length; s++) {
      if (strays[s].parentNode) strays[s].parentNode.removeChild(strays[s]);
    }

    // Carry an open modal across the replacement, otherwise renderModal looks
    // up a trigger id that no longer exists and silently closes itself.
    var modalWasOnExisting = !!(existing && state.modal && state.modal.triggerId === existing.id);
    if (existing) {
      state.triggers = state.triggers.filter(function (x) {
        return x !== existing;
      });
    }

    var hostEl = document.createElement("div");
    hostEl.setAttribute(BADGE_ATTR, "");
    hostEl.setAttribute(DETAILS_ATTR, "");
    styleInlinePill(hostEl, slot.el.parentNode || slot.el, cfg.marginTopPx);
    hostEl.style.display = "none";
    var root = hostEl.attachShadow({ mode: "open" });

    if (slot.mode === "inside") slot.el.appendChild(hostEl);
    else if (slot.el.parentNode) slot.el.parentNode.insertBefore(hostEl, slot.el.nextSibling);
    else slot.el.appendChild(hostEl);

    var newId = state.nextId++;
    if (modalWasOnExisting && state.modal) state.modal.triggerId = newId;
    state.triggers.push({
      id: newId,
      kind: "details",
      cardEl: null,
      rowEl: anchor.row,
      slotEl: slot.el,
      // The block matches the typography of the row it sits under, the same way
      // a rate-card teaser matches the conditions line above it.
      anchorEl: anchor.row,
      anchorInfo: anchor,
      hostEl: hostEl,
      root: root,
      label: null,
      rateNameText: null,
      cardKey: null,
      item: null,
      amountCents: null,
      nightlyAmountCents: null,
      detailsTotalCents: null,
      currency: null,
      rateId: null,
      rateName: null,
      amountSource: null,
      preview: null,
      confirmed: null,
    });
  }

  /**
   * The checkout step's per-night figure:
   *
   *   Z = withFee(Total) / nights / payment count
   *
   * Ported from both siblings. Tax-INCLUSIVE, unlike the rate-card figure,
   * because it derives from the summary Total rather than a card's nightly
   * price. That difference is why the supporting line here says only
   * "No credit check" while the rate-card one can say "Pre-tax · No credit
   * check" — and it is the ONLY difference between the two surfaces.
   *
   * Called with a payment count of 1 to produce the per-night BASIS, which is
   * then handed to the one shared renderer exactly as a rate card's nightly
   * figure is. The renderer divides by the payment count itself, so the
   * arithmetic ends up identical on both surfaces.
   *
   * Returns null rather than guessing when either input is unusable, so a
   * failed read suppresses the figure instead of rendering a wrong one.
   */
  function summaryPerNightCents(totalCents, nights, numPayments) {
    if (totalCents == null || !isFinite(totalCents) || totalCents <= 0) return null;
    if (nights == null || nights <= 0) return null;
    if (!numPayments || numPayments <= 0) return null;
    // Through withFee like every other basis, rather than multiplying by the
    // rate here: one application point is what stops this surface and the rate
    // cards drifting onto two different fees.
    var basis = withFee(totalCents);
    if (basis == null) return null;
    return Math.round(basis / nights / numPayments);
  }

  // -------------------------------------------------------------------------
  // PLACEMENT — rate cards
  // -------------------------------------------------------------------------

  /**
   * Normal-flow block, full width. Nothing is positioned, so nothing can
   * overlap host content.
   */
  /**
   * Sizes the host so it wraps ONLY the trigger line, whatever the card's own
   * layout is.
   *
   * THE 461px BUG. The previous version set a single blanket
   * `flex: 1 0 100%` on every host, inherited from the siblings where the
   * insertion point happens to sit in block flow. On the live Olive rate card
   * the parent is a COLUMN flex container, and in a column container
   * flex-basis resolves against the MAIN axis, which is height. So
   * `flex-basis: 100%` asked for the full height of the card and `flex-grow: 1`
   * kept it there: a one-line teaser measuring 292x461, filling the card and
   * pushing its own content to the top where it read as blank space.
   *
   * The same three declarations are inert in block flow, which is exactly why
   * the other teaser — the one that landed in the room description block —
   * measured a correct 826x35. One bug, two very different-looking symptoms.
   *
   * There is no set of flex properties that is correct in both directions, so
   * the parent's layout is read and only the appropriate properties are set:
   *
   *   column flex   cross axis is horizontal, so stretch for full width and
   *                 take NO part in main-axis sizing: flex 0 0 auto, so the
   *                 height is the content's height
   *   row flex      cross axis is vertical, so basis 100% to claim a full line
   *                 and align-self flex-start so it cannot stretch to the row
   *   grid          span every column, align to the start of its row so it
   *                 cannot stretch to the row's height
   *   block flow    nothing at all is needed; setting flex properties here is
   *                 harmless but pointless, so they are left off
   *
   * Re-read on every attach rather than cached, because the card's layout can
   * change across a re-render or a breakpoint.
   */
  function styleInlinePill(hostEl, parentEl, marginTopPx) {
    var p = (CONFIG.rateCards && CONFIG.rateCards.placement) || {};
    var s = hostEl.style;
    s.display = "block";
    s.boxSizing = "border-box";
    s.width = "100%";
    // Each surface has its own gap above; everything else about the host is
    // identical, because it wraps the identical trigger.
    var mt = marginTopPx == null ? (p.marginTopPx == null ? 8 : p.marginTopPx) : marginTopPx;
    s.marginTop = mt + "px";
    // Belt and braces against a stretched or clamped box, whatever the parent
    // turns out to be. `height:auto` is what makes the host track its content.
    s.height = "auto";
    s.minHeight = "0";
    s.maxHeight = "none";
    s.minWidth = "0";
    s.position = "static";
    s.float = "none";

    var display = "";
    var direction = "row";
    try {
      var cs = parentEl && parentEl.nodeType === 1 ? ownerWin(parentEl).getComputedStyle(parentEl) : null;
      if (cs) {
        display = String(cs.display || "");
        direction = String(cs.flexDirection || "row");
      }
    } catch (e) {
      display = "";
    }

    if (display.indexOf("flex") !== -1) {
      if (direction.indexOf("column") === 0) {
        // Main axis is vertical. Any basis or grow here becomes height.
        s.flex = "0 0 auto";
        s.alignSelf = "stretch"; // cross axis is horizontal: full width
      } else {
        // Main axis is horizontal. Basis 100% claims a whole line; grow 0 so it
        // cannot expand, shrink 0 so a nowrap row cannot squeeze it to nothing.
        s.flex = "0 0 100%";
        s.alignSelf = "flex-start"; // cross axis is vertical: do not stretch
      }
    } else if (display.indexOf("grid") !== -1) {
      s.gridColumn = "1 / -1";
      s.alignSelf = "start";
      s.justifySelf = "stretch";
    }
    // Block flow needs nothing: display:block + width:100% is already a line.
  }

  /**
   * The host is mounted and populated. Does it wrap its content, or has the
   * card's layout stretched it?
   *
   * REPORTS, DOES NOT RELOCATE, for the reason ayres-overlay.js gives at
   * verifyDetailsPlacement: a runtime scramble lands the block somewhere
   * arbitrary. A host materially taller than the line inside it means
   * styleInlinePill read the parent's layout wrongly, and the fix belongs
   * there. This is the check that would have caught the 461px host on the
   * first paste instead of on the page.
   */
  function verifyTeaserBox(t) {
    if (!t.hostEl || !t.hostEl.isConnected) return;
    var trig = t.root && t.root.querySelector ? t.root.querySelector(".trig, .details") : null;
    if (!trig) return;
    var hb, tb;
    try {
      hb = t.hostEl.getBoundingClientRect();
      tb = trig.getBoundingClientRect();
    } catch (e) {
      return;
    }
    if (!hb.height || !tb.height) return;
    if (hb.height <= tb.height + 24) {
      t.__boxWarned = false;
      return;
    }
    if (t.__boxWarned) return;
    t.__boxWarned = true;
    var pcs = null;
    try {
      pcs = ownerWin(t.hostEl).getComputedStyle(t.hostEl.parentElement);
    } catch (e) {
      pcs = null;
    }
    console.warn(
      "[bliss] teaser host is " + Math.round(hb.height) + "px tall but its line is only " +
        Math.round(tb.height) + "px. The host is being stretched by its parent, not wrapping its " +
        "content.\n  parent: " + (pcs ? "display:" + pcs.display + " flex-direction:" + pcs.flexDirection +
        " align-items:" + pcs.alignItems : "(style unreadable)") +
        "\n  host flex: " + t.hostEl.style.flex + "  align-self: " + t.hostEl.style.alignSelf +
        "\n  -> styleInlinePill read the parent's layout wrongly. Fix it there."
    );
  }

  function attachBadge(card, item, priceEl, cardRateName) {
    if (card.hasAttribute(DECORATED_ATTR)) {
      // The attribute survives a re-render that replaced the card's children,
      // so confirm our node is still in there before trusting it.
      if (card.querySelector("[" + BADGE_ATTR + "]")) return;
      card.removeAttribute(DECORATED_ATTR);
    }

    var anchor = findInjectionAnchor(card, priceEl);
    // NO ANCHOR, NO TEASER. There is deliberately no floating fallback: the
    // brief is that nothing is ever injected outside a rate card, and a card
    // whose insertion point cannot be resolved is skipped like a card with no
    // matching rate. Counted by the caller either way.
    if (!anchor || anchor.parentNode !== card) return false;

    var hostEl = (card.ownerDocument || document).createElement("div");
    hostEl.setAttribute(BADGE_ATTR, "");
    // The host joins the ANCHOR's parent, which is the card itself here, so
    // that is the layout styleInlinePill has to size against.
    styleInlinePill(hostEl, card);
    hostEl.style.display = "none";
    var root = hostEl.attachShadow({ mode: "open" });

    // Sibling insertion mutates the card's child list, which a re-render will
    // discard. That is covered: the observer re-runs decorate, and the
    // DECORATED_ATTR guard plus the "is our node still in there" check make
    // re-insertion idempotent rather than duplicating.
    card.insertBefore(hostEl, anchor.nextSibling);

    var t = {
      id: state.nextId++,
      kind: "rate-card",
      cardEl: card,
      hostEl: hostEl,
      root: root,
      // The line the teaser sits under. renderTrigger reads its font family and
      // text alignment so the teaser matches it.
      anchorEl: anchor,
      label: findRoomName(card, item, cardRateName),
      // The card's OWN rate name, frozen at build time. This is the identity a
      // DOM-sourced card has instead of a dataLayer item, and it is what
      // matchItemForCard uses as its name gate on every later recompute.
      rateNameText: cardRateName || null,
      // Frozen at build time and never recomputed, so the same card keys the
      // same way before and after the first recompute.
      cardKey: cardKeyFor(item, cardRateName),
      item: item || null,
      amountCents: null,
      nightlyAmountCents: null,
      currency: null,
      rateId: null,
      rateName: null,
      amountSource: null,
      preview: null,
      confirmed: null,
    };
    card.setAttribute(DECORATED_ATTR, String(t.id));
    state.triggers.push(t);
    return true;
  }

  // Last reported card set, so a per-mutation sync logs only on a real change.
  var lastCardReport = null;

  /**
   * Finds every rate card on screen and decorates the ones that resolve to a
   * dataLayer rate.
   *
   * DOM FIRST. Price anchors resolve to cards, cards dedupe, and only then is
   * each card matched to an item. A card that matches no item is counted and
   * skipped; an item that matches no card is never looked at. That is the whole
   * of the inversion, and it is why 8 items against 2 rendered cards produce 2
   * teasers rather than 3 anchored and 5 floating.
   */
  function decorateRateCards() {
    var items = (state.dl && state.dl.items) || [];

    // NOTHING TO PLAN AGAINST, SO NOTHING IS MOUNTED. Without a check-in date
    // or a rate, every teaser would resolve to invalid_input, render nothing,
    // and hide itself — leaving a 0x0 shadow host with two stylesheets and no
    // content inside each of the customer's rate cards. Invisible, but real,
    // and it accumulates. ayres-overlay.js calls this out at
    // reportDetailsSuppressed; here it is cheaper to simply never mount.
    //
    // Not a one-way door: the observer, the hash listener and the dataLayer
    // push hook all re-run sync, so teasers appear the moment the guest picks
    // dates and Olive pushes its rates.
    // The gate is a STAY, not a dataLayer. Dates and a nights count are what
    // every figure is computed from; the rates array only supplies precision
    // where it happens to carry the rate. With no items at all, every card is
    // simply priced from its own DOM — which is the same path the Exclusive
    // Rate already takes.
    if (!state.dl || !state.dl.checkin || !state.dl.nights || state.dl.nights <= 0) {
      state.lastCardCount = 0;
      state.lastUnmatchedCount = 0;
      return;
    }

    var anchors = findPriceAnchors(document);
    var seen = [];
    var seenAnchors = [];
    var seenNames = [];
    var claimed = [];
    var report = [];
    var rejections = [];
    var unmatched = 0;
    var unanchored = 0;
    var noConditions = 0;
    var noPrice = 0;

    // STRICT FIRST, RELAX ONLY IF THE PAGE YIELDS NOTHING.
    //
    // The room detail page and the checkout page both carry per-night wording,
    // so they resolve on the strict pass and never reach the relaxed one — the
    // fallback cannot change what they already do. The multi-room results list
    // carries none, so its strict pass finds nothing and the relaxed pass is
    // what makes it work. Page-scoped, so a page cannot mix the two.
    var mode = CONFIG.rateCards.requirePerNight;
    var passes = mode === false ? [true] : mode === true ? [false] : [false, true];
    var relaxed = false;
    var usedRelaxed = false;

    for (var pass = 0; pass < passes.length; pass++) {
      relaxed = passes[pass];
      if (relaxed) {
        seen = [];
        seenAnchors = [];
        seenNames = [];
        rejections = [];
        noConditions = 0;
      }
      collect(relaxed);
      if (seen.length) {
        usedRelaxed = relaxed;
        break;
      }
    }
    state.lastDiscoveryMode = usedRelaxed ? "relaxed" : "strict";

    function collect(isRelaxed) {
    for (var i = 0; i < anchors.length; i++) {
      var found = resolveCard(anchors[i], items, rejections, anchors, isRelaxed);
      if (!found) continue;
      var card = found.el;
      if (seen.indexOf(card) !== -1) continue;

      // CONTAINMENT DEDUPE. Identity alone is not enough: two anchors in the
      // same card can resolve to a node and to one of its own ancestors, and
      // both would be treated as separate cards. Keep the INNERMOST, which is
      // the card; drop anything that contains an accepted card or is contained
      // by one.
      var nested = false;
      for (var s = 0; s < seen.length; s++) {
        if (seen[s].contains(card)) {
          nested = true; // an inner card already stands for this one
          break;
        }
        if (card.contains(seen[s])) {
          // This candidate is an ancestor of one we already took. The inner one
          // is the card, so this is the list or a wrapper. Drop it.
          nested = true;
          break;
        }
      }
      if (nested) continue;

      if (!found.viaConditions) noConditions++;
      seen.push(card);
      seenAnchors.push(anchors[i]);
      seenNames.push(found.rateName || null);
    }
    }

    for (var c = 0; c < seen.length; c++) {
      var cardEl = seen[c];
      var cardRateName = seenNames[c];

      // The card's LIVE price, which is both the fallback basis and the gate
      // the dataLayer match has to pass. Never the struck comparison.
      var scraped = scrapeCardNightlyCents(cardEl);
      var liveCents = scraped ? scraped.cents : null;

      var item = matchItemForCard(cardEl, items, claimed, liveCents, cardRateName);

      // NO ITEM IS NO LONGER A REJECTION. Olive publishes one rate per room on
      // this property, so a rate it does not carry still gets a teaser, priced
      // from the card. The dataLayer adds cents; it is not the ticket in.
      if (item) {
        if (CONFIG.rateCards.excludeRatePattern && CONFIG.rateCards.excludeRatePattern.test(item.rateName || "")) {
          continue;
        }
        claimed.push(item);
      } else {
        unmatched++;
        if (liveCents == null) {
          // No item AND no readable price: there is nothing to plan against.
          noPrice++;
          continue;
        }
      }

      rememberCurrencyHint(normText(cardEl));
      var ok = attachBadge(cardEl, item, seenAnchors[c], cardRateName);
      if (!ok && !cardEl.hasAttribute(DECORATED_ATTR)) unanchored++;
      report.push({
        room: item ? item.roomName || "(unnamed)" : pageRoomName() || "(room not named)",
        rate: cardRateName || (item ? item.rateName || item.rateCode : "(no rate name)"),
        source: item ? "dataLayer" : "DOM",
        nightly: money(item ? item.nightlyCents : liveCents, (item && item.currency) || CONFIG.currencyFallback),
        prices: scraped ? scraped.candidates.join(" ") : "-",
        nights: item && item.nights != null ? item.nights : state.dl.nights,
      });
    }

    state.lastCardCount = seen.length;
    state.lastUnmatchedCount = unmatched;
    state.lastCardReport = report;

    // Say how many cards matched and which rate each resolved to, so the
    // figures can be checked against the page without opening devtools. Keyed
    // on the content so a settled page does not repeat itself.
    var key = JSON.stringify(report) + "|" + unmatched + "|" + unanchored + "|" + items.length +
      "|" + rejections.length + "|" + noConditions;
    if (key !== lastCardReport) {
      lastCardReport = key;
      if (report.length) {
        console.log(
          "[bliss] " + seen.length + " rate card(s) on screen, " + report.length + " decorated " +
            "(the dataLayer carries " + items.length + " rate(s) for the whole property):"
        );
        for (var r = 0; r < report.length; r++) {
          console.log(
            "  " + (r + 1) + ". " + report[r].room + " / " + report[r].rate +
              "  ->  " + report[r].nightly + " x " + report[r].nights + " nights" +
              "   [price from " + report[r].source + "]" +
              "   prices in card: " + report[r].prices
          );
        }
      } else {
        console.log("[bliss] " + seen.length + " rate card(s) on screen, 0 decorated.");
      }
      if (unmatched) {
        console.log(
          "[bliss] " + unmatched + " card(s) had no dataLayer rate. That is expected on this property: " +
            "Olive's view_item_list publishes one rate per room, so every other rate is priced from the " +
            "card itself. The dataLayer is preferred (it carries cents where the card rounds to dollars), " +
            "not required."
        );
      }
      if (noPrice) {
        console.warn(
          "[bliss] " + noPrice + " card(s) skipped: no dataLayer rate AND no readable price in the card, " +
            "so there is nothing to plan against."
        );
      }
      if (unanchored) {
        console.log(
          "[bliss] " + unanchored + " card(s) skipped: no insertion point inside the card. " +
            "Nothing is ever injected outside a card. Check CONFIG.rateCards.conditionsRe."
        );
      }
      if (usedRelaxed) {
        console.warn(
          "[bliss] NO per-night wording anywhere near a price on this page, so discovery fell back to " +
            "the relaxed rule: a rate card is a price PLUS a rate name element PLUS a conditions line, " +
            "all three required (no two-of-three fallback). The strict pass ran first and found nothing. " +
            "This is expected on the multi-room results list and should NOT happen on the room detail " +
            "page — if you see it there, the per-night wording has changed and " +
            "CONFIG.rateCards.perNightRe needs updating rather than this fallback carrying it."
        );
      }
      if (noConditions) {
        console.warn(
          "[bliss] " + noConditions + " card(s) identified on a per-night price and a rate name but " +
            "no recognised conditions line, so the teaser sits under the price instead. " +
            "Add the card's wording to CONFIG.rateCards.conditionsRe to place it properly."
        );
      }
      // THE RATE-NAME INVENTORY. Printed every time the card set changes, not
      // only on a failure: the match is between what Olive renders and what
      // Olive reports, and when those two disagree the only way to see it is to
      // have both in front of you. This is the half that is otherwise invisible.
      var inv = [];
      for (var v = 0; items.length && v < items.length; v++) {
        inv.push(
          "    " + (v + 1) + ". item_category=" + JSON.stringify(items[v].rateName) +
            "  item_category2=" + JSON.stringify(items[v].rateCode) +
            "  (" + (items[v].roomName || "?") + ", " +
            money(items[v].nightlyCents, items[v].currency || CONFIG.currencyFallback) + "/night)"
        );
      }
      if (inv.length) {
        console.log("[bliss] dataLayer rate names, all " + items.length + " of them:\n" + inv.join("\n"));
      } else {
        console.log("[bliss] the dataLayer carries no rates at all. Every card is priced from its own DOM.");
      }

      // A node that quotes a price per night but matched no rate name looks
      // exactly like a rate card and is being dropped, so print its FULL text
      // beside the inventory above. Everything needed to see why the match
      // failed is then in one place, in the same run.
      for (var u = 0; u < rejections.length; u++) {
        if (!rejections[u].cardText) continue;
        console.warn(
          "[bliss] this node quotes a price per night but exposes no RATE NAME ELEMENT, so it was not " +
            "treated as a rate card. A rate name is a short line that is not the price, not the " +
            "per-night marker, not the conditions line, not a sentence, and not the button label:\n" +
            "  price seed : " + rejections[u].text + "\n" +
            "  card text  : " + JSON.stringify(rejections[u].cardText) + "\n" +
            "  -> if the rate name is in there, widen looksLikeRateName()."
        );
      }

      // Every price on the page that did NOT become a card, and why. This is
      // what makes "nothing else got a teaser" checkable rather than assumed:
      // the fee chips should all appear here as "not a per-night price".
      if (rejections.length) {
        var byReason = {};
        for (var q = 0; q < rejections.length; q++) {
          var w = rejections[q].why;
          (byReason[w] = byReason[w] || []).push(rejections[q].text);
        }
        var lines = [];
        for (var reason in byReason) {
          if (!Object.prototype.hasOwnProperty.call(byReason, reason)) continue;
          lines.push("    " + byReason[reason].length + " x " + reason + ": " + byReason[reason].join(", "));
        }
        console.log(
          "[bliss] " + rejections.length + " price(s) on the page rejected as not-a-rate-card:\n" +
            lines.join("\n")
        );
      }
    }
  }

  /** Whether a trigger's own nodes are still mounted. */
  function triggerAlive(t) {
    if (!t || !t.hostEl) return false;
    // The checkout block owns no card, so it is alive exactly while its own
    // node is still mounted. Same rule both siblings use for their details step.
    if (t.kind === "details") return !!t.hostEl.isConnected;
    return !!(t.cardEl && t.cardEl.isConnected && t.hostEl.isConnected);
  }

  /**
   * Whether some OTHER live trigger is currently mounted on this card.
   *
   * The children-replaced re-render is the case this exists for: Olive keeps
   * the card element and swaps its subtree, which takes our teaser with it.
   * decorateRateCards runs before pruneTriggers, so by the time we get here a
   * fresh trigger has already been built on this same card element and has
   * stamped DECORATED_ATTR with its own id. Clearing the card's attributes on
   * behalf of the dead trigger would strip that stamp off a card that is still
   * decorated, and the next sync would inject a second teaser, then a third.
   */
  function cardHasLiveTrigger(card, except) {
    if (!card) return false;
    for (var i = 0; i < state.triggers.length; i++) {
      var o = state.triggers[i];
      if (o === except || o.kind !== "rate-card" || o.cardEl !== card) continue;
      if (triggerAlive(o)) return true;
    }
    return false;
  }

  /**
   * Removes every rate-card teaser, for when the page turns out to be the
   * checkout step. Unmounts the nodes and clears the marks, so a later return
   * to the rates route decorates cleanly rather than tripping the
   * already-decorated guard on a card whose teaser is gone.
   */
  function dropRateCardTriggers() {
    var kept = [];
    for (var i = 0; i < state.triggers.length; i++) {
      var t = state.triggers[i];
      if (t.kind !== "rate-card") {
        kept.push(t);
        continue;
      }
      if (t.hostEl && t.hostEl.parentNode) t.hostEl.parentNode.removeChild(t.hostEl);
      if (t.cardEl && t.cardEl.removeAttribute) t.cardEl.removeAttribute(DECORATED_ATTR);
      if (state.modal && state.modal.triggerId === t.id) closeModal();
    }
    state.triggers = kept;
  }

  /** Drops triggers whose card the SPA has unmounted. */
  function pruneTriggers() {
    var kept = [];
    for (var i = 0; i < state.triggers.length; i++) {
      var t = state.triggers[i];
      if (triggerAlive(t)) {
        kept.push(t);
        continue;
      }
      if (t.hostEl && t.hostEl.parentNode) t.hostEl.parentNode.removeChild(t.hostEl);
      if (t.cardEl && !cardHasLiveTrigger(t.cardEl, t)) {
        t.cardEl.removeAttribute(DECORATED_ATTR);
        if (t.cardEl.hasAttribute(POSITIONED_ATTR)) {
          t.cardEl.style.position = "";
          t.cardEl.removeAttribute(POSITIONED_ATTR);
        }
      }
      if (state.modal && state.modal.triggerId === t.id) closeModal();
    }
    state.triggers = kept;
  }

  // -------------------------------------------------------------------------
  // SYNC
  // -------------------------------------------------------------------------

  /**
   * The amount for a trigger, re-resolved from the dataLayer every recompute
   * rather than cached, so a date change flows straight through.
   *
   * The card's own rate is re-matched each pass too: the trigger holds a
   * reference to the item it was built with, but the dataLayer is replaced
   * wholesale on a date change, so that reference goes stale. Matching by
   * identity (room + rate + code) is what carries it across.
   */
  /**
   * Re-resolve the card's dataLayer item every recompute rather than trusting
   * the reference captured at attach: Olive replaces the array wholesale on a
   * date change, so that reference goes stale.
   *
   * Matched afresh against the card's CURRENT live price, so a re-price that
   * moves a card onto a different rate is followed rather than remembered.
   */
  function currentItemFor(t, liveNightlyCents) {
    var items = (state.dl && state.dl.items) || [];
    if (!items.length) return null;
    return matchItemForCard(t.cardEl, items, [], liveNightlyCents, t.rateNameText);
  }

  /**
   * The nightly figure and the stay total for a trigger, from the best source
   * available, re-derived on every recompute.
   *
   *   dataLayer  preferred. Carries cents (302.72) where the card rounds to
   *              dollars ($303), and is the engine's own number.
   *   DOM        used when the dataLayer does not carry this rate at all, which
   *              on this property is every rate except Plan Ahead. The live
   *              price off the card, never the struck comparison beside it.
   *
   * Which one was used is recorded on the trigger and printed per card, so a
   * figure on screen can always be traced to where it came from.
   */
  function applyAmount(t) {
    if (t.kind === "details") {
      applyDetailsAmount(t);
      return;
    }
    var scraped = t.cardEl && t.cardEl.isConnected ? scrapeCardNightlyCents(t.cardEl) : null;
    var liveCents = scraped ? scraped.cents : null;
    t.scrapedNightlyCents = liveCents;
    t.priceCandidates = scraped ? scraped.candidates : null;

    if (scraped && scraped.allStruck && !t.__struckWarned) {
      t.__struckWarned = true;
      console.warn(
        "[bliss] every price in this card reads as struck through, so the strikethrough test is " +
          "not working on this markup. Fell back to the LAST price in document order, which is " +
          "still the live one on Olive's layout: " + scraped.candidates.join(", ")
      );
    }

    var item = currentItemFor(t, liveCents);
    var nights = (item && item.nights != null ? item.nights : null);
    if (nights == null) nights = state.dl ? state.dl.nights : null;

    var nightly = item ? item.nightlyCents : liveCents;
    if (nightly == null || nights == null || nights <= 0) {
      // No nightly figure, or no nights to multiply it by, means no stay total
      // and nothing to plan against. Suppress rather than guess: the same rule
      // toStayTotalCents enforces in both siblings.
      t.item = item || null;
      t.amountCents = null;
      t.nightlyAmountCents = null;
      t.amountSource = null;
      return;
    }

    t.item = item || null;
    // Both figures go through withFee, which is what keeps the teaser and the
    // modal on one basis. See fromLine.
    t.nightlyAmountCents = withFee(nightly);
    t.amountCents = withFee(nightly * nights);
    t.currency = (item && item.currency) || null;
    t.rateId = (item && item.id) || null;
    t.rateName = (item && item.rateName) || t.rateNameText || null;
    t.amountSource = item ? "dataLayer" : "DOM";
  }

  /**
   * The checkout block's basis: the tax-inclusive Total through withFee, and
   * the nights from the summary card's own date range.
   *
   * BOTH FROM THE DOM. The dataLayer may not carry this booking at all, and on
   * the booking route the hash holds a cart id rather than dates, so neither is
   * a source here. Whether the dataLayer happens to corroborate is reported and
   * nothing more.
   */
  function applyDetailsAmount(t) {
    var anchor = t.anchorInfo && t.anchorInfo.label && t.anchorInfo.label.isConnected
      ? t.anchorInfo
      : resolveCheckoutAnchor();
    if (anchor) t.anchorInfo = anchor;

    var total = anchor ? scrapeDetailsTotalCents(anchor) : null;
    var stay = anchor ? parseSummaryDates(anchor.summary) : null;

    t.detailsTotalCents = total;
    t.nights = stay ? stay.nights : null;
    t.checkin = stay ? stay.checkin : null;
    t.checkout = stay ? stay.checkout : null;
    // Set on both paths, so a card that stops naming its room clears the old
    // subtitle instead of leaving the last one standing under new numbers.
    t.label = checkoutLabel(anchor);

    reportCheckoutStay(t, stay, total);

    if (total == null || !stay) {
      t.amountCents = null;
      t.nightlyAmountCents = null;
      t.amountSource = null;
      return;
    }
    // The modal is written against the tax-inclusive total through withFee —
    // the same basis, and the same fee rate, the block's own teaser uses, so
    // the two agree by construction rather than by coincidence. At the zero
    // rate that basis IS the property's Total, to the cent.
    t.amountCents = withFee(total);
    // THE ONE THING THAT DIFFERS ON THIS SURFACE. A rate card gets its nightly
    // figure from the dataLayer or from the card's own price; here it is
    // derived from the tax-inclusive Total over the night count. Everything
    // downstream — fromLine, the teaser markup, the copy — is then the same
    // code doing the same thing, because it is the same teaser.
    t.nightlyAmountCents = summaryPerNightCents(total, stay.nights, 1);
    t.currency = (state.dl && state.dl.currency) || null;
    t.rateName = null;
    t.amountSource = "DOM (Trip Summary)";
  }

  /** The modal subtitle on the checkout step: the room, when the card names it. */
  function checkoutLabel(anchor) {
    if (!anchor || !anchor.summary) return null;
  var room = null;
  try {
    var lines = String(anchor.summary.textContent || "").split(/\n+/).map(function (s) { return s.replace(/\s+/g, " ").trim(); }).filter(Boolean);
    for (var i = 1; i < lines.length; i++) {
      if (/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}\s*[-–]/i.test(lines[i])) { room = lines[i - 1]; break; }
    }
  } catch (e) {}
  if (room && room.length < 60 && !/\$/.test(room)) return room;
    if (state.dl && state.dl.hotelName) return state.dl.hotelName;
    return "Your stay";
  }

  // One line per distinct parsed state, so a per-mutation sync cannot spam.
  var lastCheckoutKey = null;

  function reportCheckoutStay(t, stay, total) {
    var key = [
      stay ? formatDate(stay.checkin) : null,
      stay ? formatDate(stay.checkout) : null,
      stay ? stay.nights : null,
      total,
    ].join("|");
    if (key === lastCheckoutKey) return;
    lastCheckoutKey = key;

    if (!stay) {
      // NOT A SILENT NULL. Print what was looked at and why each string was
      // rejected, plus every text node in the card, so the next failure is one
      // line in the console rather than another round trip.
      var scopes = t.anchorInfo ? dateScopes(t.anchorInfo.summary) : [];
      var widest = scopes.length ? scopes[scopes.length - 1] : null;
      var lines = [];
      lines.push(
        "[bliss] checkout block: could not parse a date range, so there is no nights count and the " +
          'block stays hidden. Expected something like "Dec 16 - 17".'
      );
      lines.push(
        "  markers container : <" + (t.anchorInfo && t.anchorInfo.summary
          ? t.anchorInfo.summary.tagName.toLowerCase()
          : "?") + ">  " +
          JSON.stringify(t.anchorInfo ? normText(t.anchorInfo.summary).slice(0, 90) : "")
      );
      lines.push("  scopes searched   : " + scopes.length + " (climbing outward from that container)");

      if (lastDateFailure && lastDateFailure.length) {
        // Most-plausible first: a string carrying a month name or a separator
        // is a candidate that nearly worked, and it is the one worth reading.
        // A list of amounts sorted by nothing is a list nobody reads.
        var ranked = lastDateFailure.slice().sort(function (a, b) {
          function w(x) {
            var n = 0;
            if (/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(x.text)) n += 2;
            if (/-|\u2013|\u2014|\bto\b/.test(x.text)) n += 1;
            return n;
          }
          return w(b) - w(a);
        });
        lines.push("  strings examined, most-plausible first, and why each was rejected:");
        for (var e = 0; e < ranked.length && e < 15; e++) {
          lines.push("    " + JSON.stringify(ranked[e].text) + "  ->  " + ranked[e].why);
        }
        if (ranked.length > 15) lines.push("    ... and " + (ranked.length - 15) + " more");
      } else {
        lines.push("  strings examined  : none. The scope search found no text at all.");
      }

      var nodes = dumpTextNodes(widest, 40);
      lines.push("  text nodes in the Trip Summary card (parent | text):");
      for (var n = 0; n < nodes.length; n++) {
        lines.push("    " + nodes[n].parent + "  |  " + JSON.stringify(nodes[n].text));
      }
      if (!nodes.length) lines.push("    (none)");
      lines.push(
        "  -> if the range IS in that list, widen the patterns at RANGE_MDY / RANGE_DMY / RANGE_NUM."
      );
      console.warn(lines.join("\n"));
      return;
    }
    // Does the dataLayer know about this booking at all? Reported, not used:
    // the basis is the tax-inclusive Total either way.
    var items = (state.dl && state.dl.items) || [];
    console.log(
      "[bliss] checkout block: check-in " + formatDate(stay.checkin) +
        "  |  check-out " + formatDate(stay.checkout) +
        "  |  nights " + stay.nights +
        "  |  dates from: Trip Summary card (\"" + stay.text + "\" via " + stay.via +
        ", scope +" + stay.scope + "), NOT the URL hash" +
        "  |  total " + (total == null ? "UNREADABLE" : money(total, CONFIG.currencyFallback)) +
        " (tax-inclusive)" +
        "  |  basis: DOM" +
        "  |  dataLayer " + (items.length ? "carries " + items.length + " rate(s), not used here" : "carries nothing")
    );
  }

  // One-shot per distinct failure state, so a per-mutation sync cannot spam.
  var lastDetailsSuppressKey = null;

  /** Why the checkout block rendered nothing. Every input, so it is diagnosable. */
  function reportDetailsSuppressed(t) {
    var p = t.preview;
    var key = [p && p.eligible, p && p.reason, p ? p.options.length : -1, t.nights, t.detailsTotalCents].join("|");
    if (key === lastDetailsSuppressKey) return;
    lastDetailsSuppressKey = key;
    var why;
    if (t.detailsTotalCents == null) {
      why = 'the "Total" amount could not be assembled. Check CONFIG.detailsStep.totalLabelRe.';
    } else if (t.nights == null) {
      why = "the nights count is unknown, and the block quotes a per-night figure.";
    } else if (!p) {
      why = "no eligibility preview was computed.";
    } else if (!p.eligible) {
      why =
        "the plan rules reject this basis: " + p.reason + ". " + (REASON_COPY[p.reason] || "") +
        "\n     NOTE: this block and the rate cards are gated on DIFFERENT bases. The cards use the " +
        "pre-tax nightly figure; this uses the tax-inclusive Total plus the Bliss fee, which is larger.";
    } else {
      why = "no cadence fits between today and check-in.";
    }
    console.warn(
      "[bliss] checkout block rendered nothing.\n" +
        "  Total parsed : " + (t.detailsTotalCents == null ? "NO" : money(t.detailsTotalCents, cur(t))) + "\n" +
        "  plan basis   : " + (t.amountCents == null ? "null" : money(t.amountCents, cur(t))) + "\n" +
        "  nights       : " + t.nights + "\n" +
        "  eligibility  : " + (p ? (p.eligible ? "eligible" : "INELIGIBLE (" + p.reason + ")") : "none") + "\n" +
        "  -> " + why
    );
  }

  function recompute() {
    state.triggers.forEach(function (t) {
      applyAmount(t);
      t.preview = computeFor(t.amountCents, t.checkin);

      if (t.kind === "details") {
        // State A/B is driven by the session-level choice, not by this
        // trigger's own confirmation — the rate-card trigger that recorded it
        // is on a different route and no longer exists. Mirrored onto
        // `confirmed` so the modal's "Plan selected" receipt renders unchanged.
        t.confirmed = state.planChoice;
        if (t.confirmed && !optionByFrequency(t.preview, t.confirmed.frequency)) t.confirmed = null;
        return;
      }

      t.label = findRoomName(t.cardEl, t.item, t.rateNameText) || t.label;

      // Restore after an Olive re-render. The trigger that recorded the plan
      // was destroyed along with the card and decorateRateCards built a fresh
      // one in its place with confirmed:null, so the session-level planChoice
      // is the only surviving copy. Keyed on rate identity, so it lands on the
      // ONE card the guest actually chose and every other card stays
      // unconfirmed. Both keys must be non-null: a card with no resolvable rate
      // keys to null and must not match another null.
      if (
        !t.confirmed &&
        state.planChoice &&
        state.planChoice.cardKey &&
        t.cardKey &&
        state.planChoice.cardKey === t.cardKey
      ) {
        t.confirmed = state.planChoice;
      }
      if (t.confirmed) {
        // Invalidate only when the CADENCE is no longer offered. A changed
        // amount is not grounds to drop the confirmation: the figure is derived
        // at render, so it simply follows the new basis. Runs after the restore
        // above, so a restored confirmation is checked against the current
        // preview on the same pass rather than a sync later.
        if (!optionByFrequency(t.preview, t.confirmed.frequency)) t.confirmed = null;
      }
    });
    if (state.modal) {
      var mt = triggerById(state.modal.triggerId);
      if (!mt) closeModal();
      else if (state.modal.selected != null && !optionByFrequency(mt.preview, state.modal.selected)) {
        // Repair only a selection that has become INVALID — a cadence the rules
        // no longer offer, or one the new dates no longer fit. A null selection
        // is deliberate (the guest deselected) and must survive: repairing it
        // would silently re-select the plan they had just cancelled.
        state.modal.selected = defaultSelected(mt.preview);
      }
    }
  }

  function ensureTheme() {
    if (state.theme) return;
    state.theme = sampleHostTheme(window);
  }

  function rangeChanged(a, b) {
    if (!a || !b) return false;
    return a.checkinIso !== b.checkinIso || a.checkoutIso !== b.checkoutIso || a.nights !== b.nights;
  }

  function sync() {
    ensureTheme();
    ensureHook();
    var prev = state.dl;
    state.dl = readDataLayer();

    // A date change invalidates every figure on the page, so say so once and let
    // the unconditional recompute below do the work. Nothing is guarded on this
    // flag: recompute() and renderAllTriggers() run every sync anyway, so the
    // new nights count reaches every teaser and any open modal by the same path
    // a card re-render already used.
    if (prev && rangeChanged(prev, state.dl)) {
      console.log(
        "[bliss] stay changed: " + prev.checkinIso + " to " + prev.checkoutIso +
          " (" + prev.nights + " nights)  ->  " + state.dl.checkinIso + " to " + state.dl.checkoutIso +
          " (" + state.dl.nights + " nights). Recomputing every teaser" +
          (state.modal ? " and the open modal." : ".")
      );
    }

    // WHICH PAGE ARE WE ON? Decided by which anchors exist, never by the URL:
    // both surfaces are hash routes on one origin, and Olive rewrites the hash
    // without a navigation, so a URL test would be reading a value that changes
    // out from under the DOM it is meant to describe.
    //
    // The checkout anchor is the more specific of the two — a Total row inside
    // a card that also carries "Nightly Rate" and "Taxes and Fees" — so it is
    // tested first and wins. The two modes are mutually exclusive by
    // construction: each drops the other's triggers before mounting its own.
    var checkoutAnchor = resolveCheckoutAnchor();
    if (checkoutAnchor) {
      dropRateCardTriggers();
      ensureDetailsTrigger(checkoutAnchor);
    } else {
      dropDetailsTrigger();
      decorateRateCards();
    }

    pruneTriggers();
    recompute();
    renderAllTriggers();
    ensureObserver();
    if (state.modal) renderModal();
  }

  function refresh() {
    state.theme = null; // force a re-sample
    sync();
  }

  // ---- re-attach after SPA re-renders --------------------------------------
  // Olive re-renders the room list on a date or room change, which takes our
  // teasers with it. Re-running sync is cheap because attachBadge is guarded by
  // DECORATED_ATTR, so a settled page does no work per mutation.
  //
  // FOUR ENTRY POINTS, because no single one catches every change:
  //   - the MutationObserver, for a re-render in place
  //   - hashchange / popstate, because Olive is a hash router and its dates
  //     live in the hash, so a date change is a route change
  //   - the dataLayer.push hook below, for a re-price that pushes new items
  //     without a route change
  //   - a debounced resize, ported from ayres-overlay.js where closing DevTools
  //     resized the viewport, re-rendered the host and stranded the overlay
  var moPending = false;
  var observer = null;
  var navBound = false;

  /**
   * Set when this instance has been superseded or destroyed. Every deferred
   * entry point checks it, because a callback already queued cannot be
   * cancelled by disconnecting the observer that queued it.
   */
  var quiesced = false;

  function quiesce() {
    quiesced = true;
  }

  function onMutation() {
    if (quiesced || moPending) return;
    moPending = true;
    schedule(function () {
      moPending = false;
      if (quiesced) return;
      try {
        sync();
      } catch (e) {
        console.warn("[bliss] sync failed", e);
      }
    });
  }

  var RESIZE_DEBOUNCE_MS = 200;
  var resizeTimer = null;

  function onViewportResize() {
    if (resizeTimer != null) window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(function () {
      resizeTimer = null;
      if (quiesced) return;
      try {
        refresh();
      } catch (e) {
        console.warn("[bliss] resize refresh failed", e);
      }
    }, RESIZE_DEBOUNCE_MS);
  }

  function ensureObserver() {
    if (!observer && document.body && typeof window.MutationObserver === "function") {
      try {
        observer = new window.MutationObserver(onMutation);
        // characterData as well as childList: Olive re-prices in place on a
        // date change, which can rewrite a price text node without replacing
        // any element, and a childList-only observer would sleep through it.
        observer.observe(document.body, { childList: true, subtree: true, characterData: true });
      } catch (e) {
        observer = null;
      }
    }
    if (!navBound) {
      try {
        window.addEventListener("popstate", onMutation);
        window.addEventListener("hashchange", onMutation);
        window.addEventListener("resize", onViewportResize);
        navBound = true;
      } catch (e) {
        /* ignore */
      }
    }
  }

  function stopObserver() {
    if (observer) {
      try {
        observer.disconnect();
      } catch (e) {
        /* ignore */
      }
      observer = null;
    }
    if (navBound) {
      try {
        window.removeEventListener("popstate", onMutation);
        window.removeEventListener("hashchange", onMutation);
        window.removeEventListener("resize", onViewportResize);
      } catch (e) {
        /* ignore */
      }
      navBound = false;
    }
    if (resizeTimer != null) {
      window.clearTimeout(resizeTimer);
      resizeTimer = null;
    }
  }

  // ---- subscribe to future dataLayer pushes --------------------------------
  // Ported from mews-overlay.js. Olive keeps pushing view_item_list as the guest
  // changes dates or rooms. Wrap push, forward everything untouched, and re-sync
  // on the next frame so a burst of pushes collapses into one repaint.
  //
  // The wrapper is idempotent and reversible: unhook() restores the original,
  // and ensureHook re-installs only when the array has been swapped out from
  // under us, which Olive does on a hard route change.
  var pending = false;
  var originalPush = null;
  var dlRef = null;

  function ensureHook() {
    var arr;
    try {
      if (!window.dataLayer) return; // nothing to hook yet; sync will retry
      arr = window.dataLayer;
    } catch (e) {
      return;
    }
    if (dlRef === arr && dlRef.push !== originalPush) return;
    unhook();
    dlRef = arr;
    originalPush = dlRef.push;
    dlRef.push = function () {
      var result = originalPush.apply(dlRef, arguments);
      if (!pending) {
        pending = true;
        schedule(function () {
          pending = false;
          if (quiesced) return;
          try {
            sync();
          } catch (e) {
            console.warn("[bliss] dataLayer sync failed", e);
          }
        });
      }
      return result;
    };
  }

  function unhook() {
    if (dlRef && originalPush) {
      try {
        dlRef.push = originalPush;
      } catch (e) {
        /* ignore */
      }
    }
    originalPush = null;
    dlRef = null;
  }

  // =========================================================================
  // BOOT
  //
  // No fetch. See the NO NETWORK note at the top: this file never calls out, so
  // there is nothing to wait for and nothing to fall back from.
  // =========================================================================

  function readInstallConfig() {
    var g = null;
    try {
      g = window.__blissOverlayConfig || null;
    } catch (e) {
      g = null;
    }
    return {
      merchant: g && g.merchant ? String(g.merchant).trim() : null,
      rules: g && g.rules ? g.rules : null,
    };
  }

  function boot() {
    var install = readInstallConfig();
    CONFIG.merchantSlug = install.merchant;
    if (install.rules) {
      CONFIG.rules = install.rules;
      CONFIG.rulesSource = "window.__blissOverlayConfig.rules";
    } else {
      CONFIG.rules = DEFAULT_RULES;
      CONFIG.rulesSource = "built-in defaults (this file makes no network call)";
    }
    start();
  }

  function start() {
    refresh(); // reads the dataLayer and the hash, decorates, observes

    var api = {
      refresh: refresh,
      destroy: function () {
        quiesce();
        unhook();
        stopObserver();
        unbindKeydown();
        closeModal();
        state.triggers.forEach(function (t) {
          if (t.hostEl && t.hostEl.parentNode) t.hostEl.parentNode.removeChild(t.hostEl);
        });
        state.triggers = [];
        state.planChoice = null;
        stripInjectedDom();
        try {
          delete window.__blissOverlay;
        } catch (e) {
          /* ignore */
        }
        try {
          delete window.blissDemoTeardown;
        } catch (e) {
          /* ignore */
        }
        console.log("[bliss] overlay removed. The page is back to stock Olive.");
      },
      open: function (triggerId) {
        openModal(triggerId == null ? (state.triggers[0] || {}).id : triggerId);
      },
      state: function () {
        return state;
      },
      /** On-demand: the stay as parsed right now, and where it came from. */
      stay: function () {
        return {
          checkinIso: state.dl && state.dl.checkinIso,
          checkoutIso: state.dl && state.dl.checkoutIso,
          nights: state.dl && state.dl.nights,
          source: state.dl && state.dl.staySource,
          hash: window.location.hash,
          search: window.location.search,
        };
      },
      /**
       * Diagnostic: what discovery found, without touching the page.
       *
       * Shows the inversion directly — every card on screen, and which dataLayer
       * rate it resolved to, including the ones that resolved to nothing.
       */
      probe: function () {
        var ca = resolveCheckoutAnchor();
        if (ca) {
          var stay = parseSummaryDates(ca.summary);
          var scopes = dateScopes(ca.summary);
          console.log("[bliss] probe: this is the CHECKOUT step, so no rate cards are looked for.", {
            totalLabel: normText(ca.label),
            totalParsed: money(scrapeDetailsTotalCents(ca), CONFIG.currencyFallback),
            row: normText(ca.row).slice(0, 80),
            markersContainer: normText(ca.summary).slice(0, 90),
            dateScopesSearched: scopes.length,
            dateRange: stay ? stay.text : null,
            parsedVia: stay ? stay.via + " (scope +" + stay.scope + ")" : null,
            nights: stay ? stay.nights : null,
            rejected: stay ? null : (lastDateFailure || []).slice(0, 12),
          });
          console.log("[bliss] probe: text nodes in the Trip Summary card:",
            dumpTextNodes(scopes[scopes.length - 1], 40));
          return [];
        }
        var items = (state.dl && state.dl.items) || [];
        var anchors = findPriceAnchors(document);
        var seen = [];
        var claimed = [];
        var rows = [];
        var rejected = [];
        var probeRelaxed = state.lastDiscoveryMode === "relaxed";
        console.log("[bliss] probe: discovery mode on this page is " +
          (state.lastDiscoveryMode || "strict") + ".");
        for (var i = 0; i < anchors.length; i++) {
          var found = resolveCard(anchors[i], items, rejected, anchors, probeRelaxed);
          if (!found) continue;
          var card = found.el;
          if (seen.indexOf(card) !== -1) continue;
          var nested = false;
          for (var s = 0; s < seen.length; s++) {
            if (seen[s].contains(card) || card.contains(seen[s])) {
              nested = true;
              break;
            }
          }
          if (nested) continue;
          seen.push(card);
          var sc = scrapeCardNightlyCents(card);
          var item = matchItemForCard(card, items, claimed, sc ? sc.cents : null, found.rateName);
          if (item) claimed.push(item);
          rows.push({
            priceText: normText(anchors[i]).slice(0, 30),
            viaConditionsLine: found.viaConditions,
            signalRateName: found.rateName,

            ctas: ctaCount(card),
            matchedRate: item ? (item.roomName || "?") + " / " + (item.rateName || item.rateCode || "?") : null,
            priceSource: item ? "dataLayer" : sc ? "DOM" : "none",
            pricesInCard: sc ? sc.candidates.join(" ") : null,
            nightly: money(item ? item.nightlyCents : sc ? sc.cents : null, item ? item.currency : null),
            nights: item ? item.nights : null,
            hasAnchor: !!findInjectionAnchor(card, anchors[i]),
            card: card,
          });
        }
        if (rejected.length) {
          console.log("[bliss] probe: " + rejected.length + " price(s) rejected as not-a-rate-card",
            rejected.slice(0, 20));
        }
        if (!rows.length) logDiscoveryDiagnostics();
        return rows;
      },
      config: CONFIG,
      __unhook: unhook,
      __unobserve: stopObserver,
      __quiesce: quiesce,
    };

    try {
      window.__blissOverlay = api;
    } catch (e) {
      /* ignore */
    }
    // Kept from the previous demo build of this file, so the teardown name that
    // was already in use still works. Same function, two names.
    try {
      window.blissDemoTeardown = api.destroy;
    } catch (e) {
      /* ignore */
    }

    // ---- install report ------------------------------------------------------
    // Structural discovery fails silently when a layout changes, so state what
    // was found rather than leaving it to be diagnosed.
    var teaserCount = 0;
    var hasCheckout = false;
    for (var bi = 0; bi < state.triggers.length; bi++) {
      if (state.triggers[bi].kind === "rate-card") teaserCount++;
      if (state.triggers[bi].kind === "details") hasCheckout = true;
    }
    console.log(
      "[bliss] olive overlay installed. __blissOverlay.refresh() / .destroy() / .open() / .state() / .probe() / .stay()\n" +
        "  teardown also answers to blissDemoTeardown()\n" +
        "  plan rules: " + CONFIG.rulesSource + "\n" +
        "  NO NETWORK: this file never calls out. Every figure is computed in the page.\n" +
        "  stay: " + (state.dl && state.dl.checkinIso) + " to " + (state.dl && state.dl.checkoutIso) +
        "  |  nights: " + (state.dl && state.dl.nights) +
        "  |  dates from: " + (state.dl && state.dl.staySource) + "\n" +
        "  dataLayer entries: " + (state.dl ? state.dl.dataLayerLength : 0) +
        "  |  rates in the dataLayer (whole property): " + (state.dl ? state.dl.items.length : 0) + "\n" +
        "  surface: " + (hasCheckout ? "CHECKOUT STEP (Trip Summary)" : "RATES") +
        "  (decided by which anchors are present, not by the URL)\n" +
        "  discovery mode: " + (state.lastDiscoveryMode || "strict") +
        (state.lastDiscoveryMode === "relaxed" ? " (no per-night wording on this page)" : "") + "\n" +
        "  rate cards on screen: " + (state.lastCardCount || 0) +
        "  |  teasers attached: " + teaserCount +
        "  |  checkout block: " + (hasCheckout ? "mounted, tax-inclusive Total basis" : "not on this page") +
        "  |  priced from the card rather than the dataLayer: " + (state.lastUnmatchedCount || 0) + "\n" +
        "  Amount basis: nightly price x nights" +
        (feeRate() > 0
          ? ", plus the " + Math.round(feeRate() * 100) + "% Bliss fee on both surfaces"
          : ", with NO Bliss fee added on either surface (free plan)") +
        ". Teaser and modal share it, so they reconcile.\n" +
        "  Nightly price comes from the dataLayer when it carries the rate, else from the card. " +
        "The struck comparison price is never the basis."
    );

    if (!state.dl || !state.dl.sawDataLayer) {
      console.warn(
        "[bliss] window.dataLayer is missing entirely. Nothing to read. Make sure you are on a " +
          "rendered rooms page rather than the marketing site."
      );
    } else if (!state.dl.items.length && !teaserCount && !hasCheckout) {
      console.warn(
        "[bliss] the dataLayer has no ecommerce.items entry yet. Select dates and let the rates " +
          "render; the push hook will pick them up without a re-paste. Note that rates are priced " +
          "from the card when the dataLayer does not carry them, so this alone is not fatal."
      );
    } else if (!teaserCount && !hasCheckout) {
      console.warn(
        "[bliss] no teasers attached. A rate card must carry ALL THREE of: a per-night price " +
          "(money AND " + String(CONFIG.rateCards.perNightRe) + "), a rate name ELEMENT (a short line " +
          "that is not the price, the per-night marker, the conditions line, a sentence, or the button " +
          "label), and a conditions line (" + String(CONFIG.rateCards.conditionsRe) + "). " +
          "None of the three consults the dataLayer. " +
          "The rejection list above says which signal each price was missing. " +
          "Run __blissOverlay.probe() to see every candidate."
      );
      logDiscoveryDiagnostics();
    }
  }

  /**
   * What discovery actually saw, printed when nothing matched.
   *
   * The failure this exists for: the walk is correct and the page's shape has
   * changed under it. Without seeing the counts there is no way to tell that
   * apart from a matching bug.
   *
   * It also checks for shadow roots, because that is the one page shape this
   * file cannot handle and ayres-overlay.js already can — if Olive ever moves
   * its cards into a web component, the fix is a port rather than a regex tweak.
   */
  function logDiscoveryDiagnostics() {
    var anchors = findPriceAnchors(document);
    var shadowHosts = 0;
    var all;
    try {
      all = document.querySelectorAll("*");
    } catch (e) {
      all = [];
    }
    for (var i = 0; i < all.length; i++) {
      if (all[i].shadowRoot) shadowHosts++;
    }
    var items = (state.dl && state.dl.items) || [];

    console.warn(
      "[bliss] discovery diagnostics\n" +
        "  elements walked: " + all.length + "\n" +
        "  money-shaped leaves found: " + anchors.length + "\n" +
        "  cards resolved from them: " + (state.lastCardCount || 0) + "\n" +
        "  dataLayer rates available to match against: " + items.length + "\n" +
        "  open shadow roots on the page: " + shadowHosts
    );
    if (items.length) {
      console.warn("[bliss] rates the dataLayer is offering, for comparison against the card text:");
      for (var j = 0; j < items.length && j < 12; j++) {
        console.warn(
          "  " + (j + 1) + ". " + JSON.stringify(items[j].roomName) +
            " / " + JSON.stringify(items[j].rateName) +
            " / " + JSON.stringify(items[j].rateCode) +
            "  " + money(items[j].nightlyCents, items[j].currency) + " x " + items[j].nights
        );
      }
    }
    if (shadowHosts > 0 && !anchors.length) {
      console.warn(
        "[bliss] the page has " + shadowHosts + " open shadow root(s) and no price was found in the light DOM. " +
          "Olive may have moved its cards into a web component. This file is light-DOM only; " +
          "frontend/public/ayres-overlay.js has the shadow-aware traversal to port back " +
          "(deepQueryAll / deepText / parentAcrossShadow)."
      );
    }
  }

  boot();
})();
