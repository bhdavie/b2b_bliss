/* eslint-disable */
/**
 * ===========================================================================
 * CONSOLE PASTE ONLY. LOCAL DEMO. NOT SHIPPED.
 *
 * Paste this whole file into the browser console on an Ayres Hotels iHotelier
 * booking page. It is not hosted, not bundled, not referenced by any build, and
 * nothing in the app imports it. It exists so a Bliss payment plan teaser can be
 * shown on a real third-party booking engine during a demo.
 *
 * Do not link it from a page and do not treat it as a supported integration.
 * ===========================================================================
 *
 * Adapted from frontend/public/mews-overlay.js. That file is the original and
 * stays authoritative; this one is a sibling, not a replacement.
 *
 * WHAT IS THE SAME, deliberately and byte-for-byte where possible:
 *   - the eligibility / installment math
 *   - the shadow-root rendering model
 *   - the teaser markup and every copy string
 *   - the modal, its states, and all of its CSS
 *   - the Bliss palette and typography rules
 *
 * WHAT CHANGED, and only this:
 *   1. No pms_type gate. Ayres is not a Mews property.
 *   2. Stay dates come from the page URL query string, not a Mews dataLayer.
 *      iHotelier emits no dataLayer, so there is nothing to read or to hook.
 *   3. Rate cards are found by VISIBLE TEXT, not by class or data attribute.
 *      iHotelier class names are build-generated hashes and are not selectors.
 *   4. The teaser injects after the "additional taxes and fees per night" line.
 *   5. Discovery is SHADOW DOM AWARE. See the SHADOW DOM note below.
 *
 * ---------------------------------------------------------------------------
 * SHADOW DOM
 *
 * The Ayres page is an Amadeus amadeus-hos-res-wc Web Component bundle and it
 * renders the room cards inside SHADOW ROOTS. Measured on the live page:
 *
 *   document.body.innerText.includes("Avg. per night")  ->  false
 *   elements with a shadowRoot                          ->  10
 *
 * A shadow root is a separate tree. document.querySelectorAll searches one tree
 * and stops at the boundary, so the first version of this file matched nothing
 * whatsoever and probe() returned an empty array. textContent has the same
 * blind spot from the other side: on a shadow host it reports the light-DOM
 * children only, which is usually nothing.
 *
 * So discovery goes through deepQueryAll / deepText / parentAcrossShadow, which
 * cross the boundary in both directions, and each teaser is inserted into the
 * SAME shadow root as the price it belongs to rather than into the top
 * document. The MutationObserver is per-root for the same reason: an observer
 * on document.body never sees a mutation inside a shadow tree.
 *
 * OPEN ROOTS ONLY. A closed root exposes no `shadowRoot` property to script by
 * design and there is no supported way in. If the bundle ever closes its roots,
 * this file stops working and no amount of selector tuning will fix it.
 *
 * FRAMES: the page also carries 3 iframes. They are NOT walked. If discovery
 * ever comes up empty, the install report checks same-origin iframes for the
 * same text signature and says so; the frame-walking code in mews-overlay.js is
 * what to port back if that warning fires.
 *
 * ---------------------------------------------------------------------------
 * PLAN MATH PROVENANCE
 *
 * The eligibility section is a verbatim port of frontend/lib/eligibility.ts,
 * which mirrors backend PlanEligibilityService.java. Function names, ordering
 * and constants are preserved so the files stay diffable. Do not "improve" the
 * math here.
 *
 * Monthly means CALENDAR monthly: installments collect on a fixed anchor day
 * (the 2nd or the 16th, chosen by booking day), with payment 2 pushed to the
 * next anchor when the first falls inside MONTHLY_FIRST_INSTALLMENT_MIN_GAP_DAYS.
 *
 * ---------------------------------------------------------------------------
 * KNOWN ISSUE CARRIED OVER
 *
 * The teaser and the modal quote DIFFERENT BASES, by design, exactly as in
 * mews-overlay.js. The card teaser divides the card's own displayed nightly
 * price by the installment count. The modal quotes the real per-payment figure
 * off the stay total after discount and less any deposit. A guest who
 * multiplies the teaser will not arrive at the modal's number. Kept so this
 * overlay reads identically to the Marbrook teaser it demos alongside.
 * ---------------------------------------------------------------------------
 */
(function () {
  "use strict";

  var DEFAULT_API_BASE = "https://api.bliss-payments.com";

  // The Ayres demo merchant. Hardcoded rather than read off a script tag: there
  // is no script tag, this is a console paste. Override before pasting with
  // window.__blissOverlayConfig = { merchant: "...", apiBase: "..." }.
  var DEFAULT_MERCHANT_SLUG = "j9l29fke";

  // =========================================================================
  // BLISS FEE
  //
  // 5%, matching every fee source in the repo:
  //   backend   PlanCreationService.BLISS_FEE_RATE      = 0.05
  //   frontend  frontend/lib/blissFee.ts BLISS_FEE_RATE = 0.05
  //
  // Applied ON TOP of the total: the guest pays the fee and the hotel is paid
  // net, matching PlanCreationService.feeFor + buildSchedule.
  // =========================================================================
  var BLISS_FEE_RATE = 0.05;

  // =========================================================================
  // FALLBACK PLAN RULES
  //
  // mews-overlay.js deliberately has NO fallback: it refuses to render if the
  // rules fetch fails, because wrong rules put wrong money on a live booking
  // page. That reasoning does not apply here. This is a demo on a page nobody
  // can transact against through us, and a dead demo on a flaky conference wifi
  // is the worse failure, so these stand in when the fetch fails.
  //
  // Values match frontend/lib/api.ts DEFAULT_PLAN_RULES for the 13 fields
  // previewEligibility actually consults.
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
  // the source of truth for the modal. Every colour in modalCss reads from
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
  //
  // CONFIG.brand below still carries the trigger line's own colours, which are
  // Ayres-specific and are not part of this port.
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
    /**
     * Merchant plan rules. Populated at boot from
     * GET {apiBase}/api/v1/public/merchants/{slug}/plan-rules, falling back to
     * DEFAULT_RULES above. Never null by the time start() runs.
     * @type {object|null}
     */
    rules: null,

    /** Where the rules came from, for the install report. */
    rulesSource: null,

    /**
     * Stay dates, read from the top document's URL.
     *
     * iHotelier puts them on the query string as MM/DD/YYYY:
     *   ?adults=1&children=0&datein=12/11/2026&domain=www.ayreshotels.com
     *
     * dateout is frequently absent on the accommodations step, so a default
     * stay length stands in rather than the overlay refusing to render. Every
     * per-night figure divides by this, so it is stated here rather than buried.
     */
    stay: {
      // FALLBACK ONLY. The page's own date control outranks these: iHotelier
      // updates its picker without rewriting the URL, so the query string is
      // frozen at whatever the page was opened with. See readStay.
      checkinParams: ["datein", "checkin", "arrive", "startDate"],
      checkoutParams: ["dateout", "checkout", "depart", "endDate"],
      defaultNights: 2,

      /**
       * Longest text a candidate date control may carry. The control is picked
       * as the shortest text holding two dates, and this only stops the search
       * from considering large containers at all.
       */
      maxControlTextLength: 120,

      /** How far to climb from a month token looking for the whole range. */
      controlClimbMax: 6,

      /**
       * Print the parsed stay on EVERY read rather than only when it changes.
       * Off by default: sync runs on every mutation, so this is very noisy.
       */
      logEveryRead: false,
    },

    // -----------------------------------------------------------------------
    // RATE CARDS — text-based discovery.
    //
    // iHotelier class names are build-generated hashes, so there is no stable
    // selector to match on. Everything below keys off VISIBLE TEXT instead,
    // which is the only durable surface this engine offers.
    // -----------------------------------------------------------------------
    rateCards: {
      /**
       * The price LABEL, as its own element: "Current price", "Current price :".
       *
       * This is the handle discovery hangs off, not a price regex. The price
       * itself is split across three sibling text nodes on this page
       * ("Current price :" / "$" / "154.00"), so no element's text ever matches
       * a currency pattern and matching elements one at a time finds nothing.
       * See the PRICE ASSEMBLY section.
       */
      priceLabelRe: /current\s*price\s*:?\s*$/i,

      /** The same phrase found INSIDE a longer string, for splitting on it. */
      priceLabelInlineRe: /current\s*price\s*:?/i,

      /**
       * An assembled amount: digits, optional thousands commas, then exactly
       * two decimals. Deliberately does NOT require a currency symbol, because
       * the "$" is a separate text node from the digits.
       */
      amountRe: /\d[\d,]*\.\d{2}/,

      /** Loose "there is a price in here" test, for the card boundary. */
      priceShapeRe: /\$\s*\d|\d[\d,]*\.\d{2}/,

      /**
       * The text that identifies a price as a nightly rate rather than a total,
       * a fee or a strikethrough. A price with this near it is the anchor.
       */
      nightlyMarkerRe: /avg\.?\s*per\s*night/i,

      /**
       * The line the teaser is inserted after. Point 4 of the brief.
       */
      injectAfterRe: /additional\s+taxes\s+and\s+fees\s+per\s+night/i,

      /**
       * How far up from a price element to look for the nightly marker. Small
       * on purpose: the marker sits within a couple of wrappers of the price on
       * every layout worth supporting, and a large number starts matching the
       * page rather than the card.
       */
      markerClimbMax: 6,

      /**
       * Hard ceiling on how far a card boundary may climb. The real stop
       * condition is "this ancestor now contains a second price anchor", which
       * is what keeps two rooms from collapsing into one card. This is only a
       * backstop for a page with exactly one room on it.
       */
      cardClimbMax: 12,

      /**
       * True when the card's price is a nightly figure rather than a stay total.
       * "Avg. per night" is the engine saying so in its own words, and
       * nightlyMarkerRe is what requires it to be present, so this is not the
       * inference it was on Mews.
       */
      priceIsPerNight: true,

      /**
       * Rates whose room name matches this regex get no teaser. Same lever and
       * same caveat as mews-overlay.js: matching on a name is a workaround, not
       * a pay-now signal. Nothing in iHotelier exposes payment timing at
       * rate-selection time either.
       * @type {RegExp|null}
       */
      excludeRatePattern: null,

      placement: {
        /** Gap above the teaser, so it reads as its own line. */
        marginTopPx: 10,
      },
    },

    /**
     * Currency for figures rendered before anything confirms one. The overlay
     * sniffs the symbol off the scraped price; this outranks the sniff.
     */
    currencyFallback: "USD",

    /**
     * CHECKOUT STEP — the "Your Reservation" panel on
     * reservations.ayreshotels.com/.../book/checkout.
     *
     * The panel's last row is the tax-inclusive total:
     *
     *   Reservation Subtotal   $  984.00
     *   Taxes                  $  129.84
     *   Total Reservation      $ 1,113.84
     *
     * TEXT, not selectors. This page is Web Component based like the rooms
     * page, so its class names are build-generated and its shadow roots hide
     * everything from a document-scoped querySelector. The old anchorSelector /
     * totalSelector pair could not have worked here on either count.
     *
     * BASIS IS THE TAX-INCLUSIVE TOTAL, deliberately, and it is a different
     * basis from the rate cards' pre-tax nightly figure. That is why this
     * block's supporting line says only "No credit check" while the rate-card
     * one says "Pre-tax · No credit check", and why the modal's fine print
     * switches to "Tax and processing fee included" for this trigger.
     */
    detailsStep: {
      /**
       * PRIMARY ANCHOR. The custom element that renders the laid-out total, by
       * element name rather than by text.
       *
       * Text discovery is wrong for this page, which is why the block used to
       * mount into nothing. The phrase "Total Reservation" appears ONLY inside
       * the collapsed cart panel, and every node in that panel measures 0x0,
       * self and children. The block therefore landed in a subtree with no
       * layout, and verifyDetailsPlacement's four-level climb could never get
       * out of it.
       *
       * The total the guest actually sees is <ibe-ct-small-rate> reading
       * "$ 924.91", inside a 742x30 flex row whose text is "Total", inside a
       * 742x100 block, with real layout the rest of the way up through the
       * Payment Details section.
       *
       * Passed straight to deepQueryAll, so a selector works as well as a bare
       * tag name if this ever needs narrowing.
       */
      totalElementSelector: "ibe-ct-small-rate",

      /**
       * PLACEMENT TARGETS, independent of the amount anchor, tried in order.
       *
       * The two were the same node until recently, and that is why the block
       * kept landing beside the total instead of where it belongs. The amount
       * lives in <ibe-ct-small-rate> inside div.ibe-cn-checkout-page-card; the
       * block belongs at the top of the payment section, above the card brand
       * logos, below the Travel Protection panel.
       *
       * Captured structure, all light DOM with real layout:
       *
       *   div.ibe-cn-checkout-page-card
       *     ... Travel Protection panel ...
       *     div.payment-details
       *       <- we go HERE, before the card fields
       *       div.col.payment-details-b...    (logos, Name on Card, Number, Expiry)
       *       div.consent-total-wrapper
       *         div.consent-wrapper
       *           amadeus-hos-res-ct-checkbox (742x26)
       *
       * Each entry is {selector, mode}. Every candidate is resolved with
       * deepQueryAll and required to have a box, same as the amount anchor, so
       * an unlaid-out or hidden match is never chosen. First laid-out hit wins;
       * if no entry resolves, findDetailsPlacement falls through to the amount
       * anchor's own row, so a page shape we have not captured still gets a
       * block somewhere sensible rather than none at all.
       *
       * ON THE FIRST SELECTOR. The card fields container carries two classes,
       * `col` and `payment-details-b...`, the tail of which may be generated.
       * Matching is therefore on `.col` plus a SUBSTRING of the second class up
       * to its hyphen, never on the full generated name. The trailing hyphen in
       * "payment-details-" is load-bearing: it is what stops the selector also
       * matching the div.payment-details parent, whose class has no suffix.
       */
      placementTargets: [
        {
          // PREFERRED. Immediately after the Travel Protection panel, which
          // puts the block below that panel and above the card brand logos.
          //
          // TEXT, not a class. I have no capture of this panel's markup, and
          // every class on this engine that is not hand-written is generated,
          // so a class guess here would be a guess. The heading text is the
          // only identifier I can rely on. Swap this entry for a selector if a
          // stable class or id turns up on the panel.
          textRe: /travel\s*protection/i,
          // The climb from the heading stops before it reaches an ancestor that
          // also contains the card fields, so "the panel" is resolved as the
          // outermost box that still excludes what comes after it. Without this
          // the climb would happily reach the whole checkout card, and
          // inserting after THAT is how the block ended up under the heading
          // and above the panel.
          stopBeforeSelector: 'div.payment-details div.col[class*="payment-details-"]',
          climbMax: 8,
          mode: "after",
        },
        {
          selector: 'div.payment-details div.col[class*="payment-details-"]',
          mode: "before",
        },
        {
          selector: "div.consent-total-wrapper",
          mode: "first-child",
        },
      ],

      /**
       * FALLBACK ONLY, kept for the case where the element name changes. Used
       * only when no LAID-OUT instance of totalElementSelector exists, and the
       * same non-zero box requirement applies to it, so neither path can pick a
       * hidden duplicate. Also what the fallback amount scan splits on.
       */
      anchorRe: /total\s*reservation/i,
      /** Gap above the block, so it reads as its own line. */
      marginTopPx: 10,

      /**
       * TEMPORARY. The placement probe dedupes on content by default, so it
       * prints one line per distinct state rather than one per sync. Set true
       * to print on every sync instead, which is noisy but shows the cadence.
       */
      logPlacementEverySync: false,
    },

    /**
     * Property identity hook. Display-only: the overlay never posts to Bliss.
     */
    merchantSlug: DEFAULT_MERCHANT_SLUG,

    /**
     * Bliss brand colours for the trigger line. Deliberately NOT the sampled
     * host accent: the trigger is Bliss speaking inside the property's page, so
     * it should read as ours rather than as another of the host's controls. The
     * host font family is still inherited, so it sits in the page's typography
     * without borrowing its colour.
     *
     * MIGRATED TO THE AMETHYST SET. Every value below is copied from the
     * `palette` export in frontend/tailwind.config.ts, which that file states
     * is the single place a brand hex is written down. This file cannot import
     * it (console paste, no build step), so the values are duplicated here and
     * this comment is the pointer back to the source. Re-copy on a palette
     * change; a hex search in tailwind.config.ts will not reach into here.
     *
     * The previous values were the pre-migration violet set (#5A1BB5 /
     * #F4EFFF / #3F0F87) and the old warm neutrals.
     */
    brand: {
      // palette.brand.violet. Accent only: the selected option border, the
      // focus ring, the RECOMMENDED chip border. NOT a fill under white text
      // and NOT body text — amethyst is 4.23:1 on white, which tailwind
      // config flags as large-text-only. Every white-on-brand surface below
      // therefore uses ctaBg instead.
      violet: "#8B5CF6",
      // palette.brand["violet-tint"]. The RECOMMENDED chip only. Opaque by
      // definition rather than composited: an rgba fill would let the card
      // behind it show through and would drag the chip's ink text down with it.
      violetTint: "#F3EEFE",
      ink: "#17131C", // palette.ink.DEFAULT — primary text
      inkMuted: "#6E6878", // palette.ink.muted (never a border; see divider)
      // palette.brand["violet-deep"]. One step down from `violet`, exactly as
      // the old pair was: the primary action and the selected state are
      // different levels and do not share a fill. This is also the repo's own
      // CTA hover step (globals.css .btn-primary:hover), and it is the value
      // that keeps white text legible: 8.98:1 here against 4.23:1 on `violet`.
      //
      // Deliberately NOT palette.brand.lavender (#D6C8FB): lavender is a tint,
      // fill-only, and never sits behind white text.
      ctaBg: "#5B21B6", // primary button background
      onCta: "#ffffff", // primary button text, and the tick glyph on ctaBg
      surface: "#ffffff",
      divider: "#E9E5E1", // palette.brand.neutral — dividers, inactive borders
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
   * A rate figure to a stay total. The card price is nightly and the plan is
   * against the whole stay, so this is where the two meet. Returns null rather
   * than guessing when the nights count is unknown, which suppresses the teaser
   * instead of showing a figure short by a factor of the stay length.
   */
  function toStayTotalCents(cents, dl) {
    if (cents == null) return null;
    if (!CONFIG.rateCards.priceIsPerNight) return cents;
    if (!dl || dl.nights == null || dl.nights <= 0) return null;
    return cents * dl.nights;
  }

  /** The other direction: the nightly figure behind a rate price. */
  function toNightlyCents(cents, dl) {
    if (cents == null) return null;
    if (CONFIG.rateCards.priceIsPerNight) return cents;
    if (!dl || dl.nights == null || dl.nights <= 0) return null;
    return Math.round(cents / dl.nights);
  }

  /**
   * True when an element is rendered struck through, checked up its ancestor
   * chain as far as the card.
   *
   * text-decoration does not inherit as a computed value: a span inside a <del>
   * reports "none" for itself while still rendering with a line through it. The
   * ancestor walk is what catches that, along with plain <s>/<del>/<strike>.
   *
   * Kept from mews-overlay.js because iHotelier strikes a discounted rate the
   * same way, and taking the struck figure would quote the undiscounted price.
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

  /**
   * The Summary-step per-night figure:
   *
   *   Z = Total x (1 + BLISS_FEE_RATE) / nights / payment count
   *
   * Tax-INCLUSIVE, unlike the rate-card figure, because it derives from a
   * checkout total rather than a card's pre-tax nightly price. That difference
   * is why the supporting line there says only "No credit check" while the
   * rate-card one says "Pre-tax · No credit check".
   */
  function summaryPerNightCents(totalCents, nights, numPayments) {
    if (totalCents == null || !isFinite(totalCents) || totalCents <= 0) return null;
    if (nights == null || nights <= 0) return null;
    if (!numPayments || numPayments <= 0) return null;
    var withFee = Math.round(totalCents * (1 + BLISS_FEE_RATE));
    return Math.round(withFee / nights / numPayments);
  }

  var SYMBOL_CURRENCY = { "$": "USD", "£": "GBP", "€": "EUR", "¥": "JPY", "₹": "INR" };

  /** Best-effort currency. Ambiguous by nature, which is why CONFIG wins. */
  function rememberCurrencyHint(text) {
    var m = /[$£€¥₹]|\b(USD|GBP|EUR|CHF|SEK|NOK|DKK|PLN|AUD|CAD)\b/.exec(String(text || ""));
    if (!m) return;
    state.currencyHint = SYMBOL_CURRENCY[m[0]] || m[0];
  }

  // =========================================================================
  // ELIGIBILITY — verbatim port of frontend/lib/eligibility.ts
  // Identical to the same section of mews-overlay.js. Do not edit in isolation.
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

  // =========================================================================
  // STAY DATES — from the DOM first, the URL only as a fallback
  //
  // iHotelier emits no dataLayer, so there is nothing to read and nothing to
  // hook. The query string carries the dates the page was OPENED with:
  //
  //   ?adults=1&children=0&datein=12/11/2026&domain=www.ayreshotels.com
  //
  // THE URL IS NOT KEPT IN SYNC. Confirmed on the live page: the date bar reads
  // "17 Sun Jan - 23 Sat Jan" while the query string still says
  // datein=12/11/2026. Reading the URL alone therefore quoted Dec 11 and 2
  // nights on every card no matter what the guest had actually picked, which is
  // wrong dates AND a wrong night count feeding straight into every figure.
  //
  // So the date CONTROL is the source of truth and the URL is the fallback for
  // when the control cannot be found or parsed. The control renders its parts
  // as separate nodes ("17", "Sun", "Jan"), the same fragmentation the price
  // has, so its deep text is assembled and parsed rather than read off one
  // element. It carries no year, so the year is inferred.
  //
  // Read fresh on every sync, so a date change is picked up without a reload.
  // =========================================================================

  /** Parses YYYY-MM-DD as a LOCAL date. new Date("2026-12-25") would be UTC. */
  function parseLocalDate(iso) {
    if (!iso || typeof iso !== "string") return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    if (!m) return null;
    var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return isNaN(d.getTime()) ? null : d;
  }

  /**
   * MM/DD/YYYY to a LOCAL date. Slashes may arrive percent-encoded depending on
   * how the engine wrote the URL, so the caller decodes first.
   *
   * Single-digit month and day are accepted ("2/9/2027"): the engine is not
   * consistent about zero-padding and rejecting those would silently kill the
   * overlay on a date the guest can plainly see.
   */
  function parseUsDate(text) {
    if (!text) return null;
    var m = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/.exec(String(text).trim());
    if (!m) return null;
    var mo = Number(m[1]);
    var day = Number(m[2]);
    var yr = Number(m[3]);
    if (mo < 1 || mo > 12 || day < 1 || day > 31) return null;
    var d = new Date(yr, mo - 1, day);
    if (isNaN(d.getTime())) return null;
    // Rejects an overflowed date such as 02/31/2026, which Date would happily
    // roll into March rather than refuse.
    if (d.getMonth() !== mo - 1 || d.getDate() !== day) return null;
    return d;
  }

  /**
   * Query string to a plain object. Hand-rolled rather than URLSearchParams so
   * the whole file stays in one dialect, and so a malformed escape sequence
   * degrades to the raw value instead of throwing out of sync().
   */
  function queryParams(search) {
    var out = {};
    var raw = String(search || "").replace(/^\?/, "");
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

  function startOfToday() {
    var n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate());
  }

  // -------------------------------------------------------------------------
  // DATE CONTROL — parsing "17 Sun Jan - 23 Sat Jan" out of the page
  // -------------------------------------------------------------------------

  var MONTH_INDEX = {
    jan: 0, january: 0,
    feb: 1, february: 1,
    mar: 2, march: 2,
    apr: 3, april: 3,
    may: 4,
    jun: 5, june: 5,
    jul: 6, july: 6,
    aug: 7, august: 7,
    sep: 8, sept: 8, september: 8,
    oct: 9, october: 9,
    nov: 10, november: 10,
    dec: 11, december: 11,
  };

  function monthIndex(token) {
    var k = String(token || "").toLowerCase();
    return Object.prototype.hasOwnProperty.call(MONTH_INDEX, k) ? MONTH_INDEX[k] : null;
  }

  /**
   * Every day-plus-month pair in a string, in order.
   *
   * Tokenised rather than regexed as one shape, because the control interleaves
   * a weekday between the two ("17 Sun Jan") and the order is not guaranteed
   * ("Jan 17" reads the same to a guest). A day and a month within a few tokens
   * of each other pair up, whichever comes first, and the weekday is ignored
   * entirely: it is redundant with the date and only gets in the way.
   */
  function extractDayMonthPairs(text) {
    var tokens = String(text || "").replace(/[^A-Za-z0-9]+/g, " ").trim().split(/\s+/);
    var pairs = [];
    var day = null, dayAt = -1;
    var mon = null, monAt = -1;
    var WINDOW = 3;

    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i];
      var asNum = /^\d{1,2}$/.test(t) ? Number(t) : null;
      var asMon = monthIndex(t);

      if (asNum != null && asNum >= 1 && asNum <= 31) {
        day = asNum;
        dayAt = i;
        if (mon != null && i - monAt <= WINDOW) {
          pairs.push({ day: day, month: mon });
          day = null;
          mon = null;
          continue;
        }
      }
      if (asMon != null) {
        mon = asMon;
        monAt = i;
        if (day != null && i - dayAt <= WINDOW) {
          pairs.push({ day: day, month: mon });
          day = null;
          mon = null;
        }
      }
    }
    return pairs;
  }

  /**
   * The element rendering the selected stay range.
   *
   * Chosen as the SHORTEST piece of text that still holds two day-plus-month
   * pairs. Shortest is what makes it the control rather than one of its
   * ancestors: every wrapper up to <body> also contains both dates, and picking
   * any of them would work by accident until something else on the page grew a
   * date in it.
   *
   * Our own nodes are excluded. The modal quotes dates too ("Dec 11, 2026 ...
   * through Nov 16, 2026"), and letting the overlay read its own output back in
   * as the page's date control is a feedback loop, not a source.
   */
  var MONTH_TOKEN_RE = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\b/i;

  function findDateControl(root) {
    var all = deepQueryAll(root || document, "*");

    // SEEDS FIRST, then climb. Testing every element on the page directly would
    // mean a full deep-text build for every node including <body>, which is
    // quadratic and runs on every mutation of a live booking engine. The date
    // parts are leaves, so start from the leaves that name a month and climb a
    // few levels: a handful of cheap reads instead of one expensive sweep.
    var seeds = [];
    for (var i = 0; i < all.length && seeds.length < 200; i++) {
      var el = all[i];
      if (el.children && el.children.length) continue;
      if (el.shadowRoot) continue;
      if (isOurNode(el)) continue;
      var own = normText(el);
      if (!own || own.length > 40) continue;
      if (!MONTH_TOKEN_RE.test(own)) continue;
      seeds.push(el);
    }

    var best = null;
    var bestLen = Infinity;
    for (var s = 0; s < seeds.length; s++) {
      // The seed itself counts: one leaf may carry the whole range.
      var node = seeds[s];
      for (var d = 0; node && node.nodeType === 1 && d <= CONFIG.stay.controlClimbMax; d++) {
        var t = normText(node);
        if (t && t.length <= CONFIG.stay.maxControlTextLength && extractDayMonthPairs(t).length >= 2) {
          if (t.length < bestLen) {
            best = node;
            bestLen = t.length;
          }
          break; // smallest ancestor for THIS seed; other seeds still compete
        }
        node = parentAcrossShadow(node);
        if (node && isOurNode(node)) break;
      }
    }
    return best;
  }

  /** True for anything the overlay itself injected: a teaser host, or the modal. */
  function isOurNode(el) {
    var cur = el;
    for (var d = 0; cur && d < DEEP_MAX_DEPTH * 4; d++) {
      if (cur.nodeType === 1) {
        if (cur.hasAttribute && cur.hasAttribute(BADGE_ATTR)) return true;
        if (cur.id === MODAL_HOST_ID) return true;
      }
      if (modalHostEl && cur === modalHostEl) return true;
      cur = parentAcrossShadow(cur);
    }
    return false;
  }

  /**
   * A day-plus-month pair to a real date, inferring the year the control omits.
   *
   * Rolls forward, never back: a stay is a future booking, so a date that lands
   * in the past on this year's calendar belongs to next year. `after` threads
   * the check-in through, so a range crossing New Year (Dec 28 to Jan 3) gives
   * a checkout in the following year rather than one five days before arrival.
   */
  function dateFromPair(pair, today, after) {
    if (!pair) return null;
    var year = (after || today).getFullYear();
    var d = new Date(year, pair.month, pair.day);
    if (d.getMonth() !== pair.month || d.getDate() !== pair.day) return null; // e.g. Feb 31
    var floor = after || today;
    if (d.getTime() < floor.getTime()) {
      d = new Date(year + 1, pair.month, pair.day);
      if (d.getMonth() !== pair.month || d.getDate() !== pair.day) return null;
    }
    return d;
  }

  /**
   * The stay as the page currently shows it, or null when the control is absent
   * or unparsable, which is what hands over to the URL fallback.
   */
  function readStayFromDom() {
    var el = findDateControl(document);
    if (!el) return null;
    var text = normText(el);
    var pairs = extractDayMonthPairs(text);
    if (pairs.length < 2) return null;

    var today = startOfToday();
    var checkin = dateFromPair(pairs[0], today, null);
    if (!checkin) return null;
    // Checkout is floored at check-in, not at today, so a range spanning the
    // turn of the year rolls the checkout forward rather than backward.
    var checkout = dateFromPair(pairs[1], today, checkin);
    if (!checkout) return null;
    if (daysBetween(checkin, checkout) <= 0) return null;

    return { checkin: checkin, checkout: checkout, controlText: text, controlEl: el };
  }

  // One-shot per distinct parsed stay, so a per-mutation sync cannot spam the
  // console while still reporting every genuine date change.
  var lastLoggedStayKey = null;

  /**
   * The replacement for readDataLayer(). Returns the SAME SHAPE, so every
   * downstream consumer (computeFor, renderModal, confirmPlan) is untouched.
   * Fields the dataLayer supplied and the URL cannot are null by construction.
   */
  function readStay() {
    var params = queryParams(window.location.search);
    var rawIn = firstParam(params, CONFIG.stay.checkinParams);
    var rawOut = firstParam(params, CONFIG.stay.checkoutParams);

    var checkin = null;
    var checkout = null;
    var checkoutDefaulted = false;
    var source = null;
    var controlText = null;
    var controlEl = null;

    // DOM FIRST. The page's own date bar is the only thing that tracks what the
    // guest picked; the query string is frozen at whatever the page loaded with.
    var dom = readStayFromDom();
    if (dom) {
      checkin = dom.checkin;
      checkout = dom.checkout;
      controlText = dom.controlText;
      controlEl = dom.controlEl;
      source = "date control in the page";
    } else {
      checkin = parseUsDate(rawIn);
      checkout = parseUsDate(rawOut);
      source = "URL query string (date control not found or not parsable)";

      // dateout is routinely absent on the accommodations step. Default rather
      // than refuse: with no nights count every per-night figure is suppressed
      // and the overlay renders nothing at all, which looks like a broken paste.
      if (checkin && !checkout) {
        checkout = addDays(checkin, CONFIG.stay.defaultNights);
        checkoutDefaulted = true;
      }
      // A checkout on or before checkin is unusable. Fall back to the same
      // default rather than producing zero or negative nights.
      if (checkin && checkout && daysBetween(checkin, checkout) <= 0) {
        checkout = addDays(checkin, CONFIG.stay.defaultNights);
        checkoutDefaulted = true;
      }
    }

    var checkinIso = checkin ? formatDate(checkin) : null;
    var checkoutIso = checkout ? formatDate(checkout) : null;
    var nights = checkin && checkout ? daysBetween(checkin, checkout) : null;

    // Say what was parsed and WHERE FROM, so a wrong stay is visible
    // immediately rather than inferred from a wrong dollar figure. Keyed on the
    // parsed result by default, because sync runs on every mutation and a
    // repeated identical line proves nothing; every genuine date change still
    // prints. Set CONFIG.stay.logEveryRead = true to print on every read.
    var key = checkinIso + "|" + checkoutIso + "|" + source;
    if (CONFIG.stay.logEveryRead || key !== lastLoggedStayKey) {
      lastLoggedStayKey = key;
      if (checkin) {
        console.log(
          "[bliss] stay: check-in " + checkinIso +
            "  |  check-out " + checkoutIso +
            "  |  nights " + nights +
            "  |  source: " + source +
            (controlText ? '  |  control text: "' + controlText + '"' : "") +
            (checkoutDefaulted
              ? "  |  check-out absent or unusable, defaulted to +" + CONFIG.stay.defaultNights + " nights"
              : "")
        );
      } else {
        console.warn(
          "[bliss] no usable stay. The page's date control was not found or not " +
            "parsable (expected something like \"17 Sun Jan - 23 Sat Jan\"), and the URL carried no " +
            "usable date either: looked for " + CONFIG.stay.checkinParams.join(", ") +
            " in MM/DD/YYYY and found " + JSON.stringify(rawIn) + ". " +
            "Every figure needs a stay, so nothing will render."
        );
      }
    }

    return {
      staySource: source,
      controlText: controlText,
      controlEl: controlEl,
      // Kept so matchRateForCard-shaped code and the record in confirmPlan
      // stay structurally identical to mews-overlay.js. iHotelier publishes no
      // rates array, so this is always empty.
      rates: [],
      checkinIso: checkinIso,
      checkoutIso: checkoutIso,
      checkin: checkin,
      checkout: checkout,
      nights: nights,
      checkoutDefaulted: checkoutDefaulted,
      adults: params.adults == null ? null : params.adults,
      children: params.children == null ? null : params.children,
      // No cart event exists on this engine.
      value: null,
      currency: null,
      itemName: null,
      itemVariant: null,
      hotelId: null,
      hotelName: null,
      sawCart: false,
    };
  }

  // =========================================================================
  // SHADOW DOM TRAVERSAL
  //
  // The Ayres page is an Amadeus amadeus-hos-res-wc Web Component bundle: the
  // room cards render inside SHADOW ROOTS, not in the top document. Confirmed
  // on the live page:
  //
  //   document.body.innerText.includes("Avg. per night")  ->  false
  //   elements with a shadowRoot                          ->  10
  //
  // document.querySelectorAll only ever searches ONE tree, and a shadow root is
  // a separate tree, so every selector in the original file matched nothing at
  // all. textContent has the same blind spot: on a shadow host it returns the
  // LIGHT DOM children only, so a marker-counting rule reading textContent sees
  // an empty string for the very element that holds the card.
  //
  // Everything below therefore comes in a deep variant. Nothing else in the
  // overlay changes: the teaser, the modal, the copy, the CSS, the installment
  // math and the URL date parsing are untouched.
  //
  // Open roots only. A closed shadow root exposes no `shadowRoot` property to
  // script by design, and there is no supported way around that.
  // =========================================================================

  // Recursion cap. Shadow nesting on this bundle is a handful of levels deep;
  // this only exists so a pathological tree cannot hang the page.
  var DEEP_MAX_DEPTH = 12;

  function isShadowRoot(node) {
    return !!(node && node.nodeType === 11 && node.host);
  }

  /**
   * The parent of a node, CROSSING the shadow boundary.
   *
   * A shadow root's parentNode chain terminates at the root itself (nodeType
   * 11), not at the host, so a plain climb stops dead at the boundary. Stepping
   * to .host is what lets the card search continue outward into whatever
   * contains the component.
   */
  function parentAcrossShadow(node) {
    if (!node) return null;
    var p = node.parentNode;
    if (isShadowRoot(p)) return p.host;
    return p;
  }

  /**
   * Every element under `root` matching `selector`, descending into the shadow
   * root of every element that has one, at any depth.
   *
   * Shadow roots nest inside other shadow roots on this bundle, so the walk is
   * fully recursive rather than one level down. Trees do not overlap (a shadow
   * root's contents are not in its host's tree), so no result can be collected
   * twice and no dedupe pass is needed.
   *
   * @param {Document|Element|ShadowRoot} root
   * @param {string=} selector defaults to every element
   * @returns {Element[]}
   */
  function deepQueryAll(root, selector) {
    var sel = selector || "*";
    var out = [];
    var visited = [];

    function visit(node, depth) {
      if (!node || depth > DEEP_MAX_DEPTH) return;
      if (visited.indexOf(node) !== -1) return;
      visited.push(node);

      // The root itself can match, which querySelectorAll never reports.
      if (node.nodeType === 1) {
        try {
          if (node.matches && node.matches(sel)) out.push(node);
        } catch (e) {
          /* an invalid selector is the caller's problem, not a crash here */
        }
      }

      var matches;
      try {
        matches = node.querySelectorAll(sel);
      } catch (e) {
        return;
      }
      for (var i = 0; i < matches.length; i++) out.push(matches[i]);

      // Descend. The node itself may be a host, and so may anything under it.
      if (node.nodeType === 1 && node.shadowRoot) visit(node.shadowRoot, depth + 1);
      var all;
      try {
        all = node.querySelectorAll("*");
      } catch (e) {
        return;
      }
      for (var j = 0; j < all.length; j++) {
        if (all[j].shadowRoot) visit(all[j].shadowRoot, depth + 1);
      }
    }

    visit(root, 0);
    return out;
  }

  /** Every open shadow root under `root`, at any depth. For the observer. */
  function deepShadowRoots(root) {
    var out = [];
    var visited = [];

    function visit(node, depth) {
      if (!node || depth > DEEP_MAX_DEPTH) return;
      if (visited.indexOf(node) !== -1) return;
      visited.push(node);
      var all;
      try {
        all = node.querySelectorAll("*");
      } catch (e) {
        return;
      }
      if (node.nodeType === 1 && node.shadowRoot) {
        out.push(node.shadowRoot);
        visit(node.shadowRoot, depth + 1);
      }
      for (var i = 0; i < all.length; i++) {
        if (all[i].shadowRoot) {
          out.push(all[i].shadowRoot);
          visit(all[i].shadowRoot, depth + 1);
        }
      }
    }

    visit(root, 0);
    return out;
  }

  /**
   * textContent, but including shadow content.
   *
   * This is the fix that matters most for card discovery. countMarkers and
   * findInjectionAnchor both ask "does this element contain the phrase", and on
   * a shadow host plain textContent answers no for content that is plainly on
   * screen inside it.
   *
   * Slotted content is counted ONCE, not twice: walking a shadow root yields
   * the <slot> element, which contributes no text of its own, while the host's
   * light-DOM children are walked separately as themselves.
   */
  // Elements whose text content is source code or inert markup, never anything
  // the guest reads. Skipping them is not tidiness: the Amadeus component
  // bundle is very likely to contain the literal string "Avg. per night" in its
  // own source, and an inline <script> counted as page text would make
  // countMarkers see markers that are not on screen, which silently breaks the
  // card boundary for every card on the page. <template> is inert by
  // definition and would contribute text for cards that are not rendered.
  var NON_TEXT_TAGS = { SCRIPT: 1, STYLE: 1, TEMPLATE: 1, NOSCRIPT: 1, HEAD: 1, TITLE: 1 };

  function deepText(node, depth) {
    depth = depth || 0;
    if (!node || depth > DEEP_MAX_DEPTH * 4) return "";
    if (node.nodeType === 3) return node.nodeValue || "";
    if (node.nodeType !== 1 && node.nodeType !== 11) return "";
    if (node.nodeType === 1 && NON_TEXT_TAGS[node.tagName]) return "";
    var s = "";
    if (node.nodeType === 1 && node.shadowRoot) s += deepText(node.shadowRoot, depth + 1);
    var kids = node.childNodes;
    if (!kids) return s;
    for (var i = 0; i < kids.length; i++) s += " " + deepText(kids[i], depth + 1);
    return s;
  }

  // =========================================================================
  // RATE CARD DISCOVERY — by visible text
  //
  // iHotelier class names are build-generated hashes, so there is no stable
  // selector. The durable signature of a room card is its TEXT:
  //
  //   "$ 149.00"                              <- the price anchor
  //   "Avg. per night"                        <- what makes it a nightly rate
  //   "additional taxes and fees per night"   <- where the teaser goes
  //   "Best Available Rate"                   <- sits below the teaser
  //
  // Discovery runs price-first because the price is the only element that must
  // exist for the overlay to say anything at all.
  // =========================================================================

  function normText(el) {
    return String(deepText(el) || "").replace(/\s+/g, " ").trim();
  }

  /** True when the element renders no visible box. Skips hidden templates. */
  /**
   * Does this element occupy space on the page right now?
   *
   * REPLACES the old isHidden(), which read computed display and visibility and
   * had no call sites. Computed style is not enough for the failure this
   * guards: in the collapsed cart panel exactly ONE ancestor carried
   * display:none, and every node beneath it computed to a perfectly ordinary
   * display while still measuring 0x0. isHidden() would have called all of them
   * visible and picked one anyway.
   *
   * Measuring the box catches the whole family at once: display:none anywhere
   * above, a zero-height collapsed container, and a flex child squeezed to
   * nothing all fail this test, which is the only property the anchor actually
   * needs. An unreadable box is treated as no box, because an anchor we cannot
   * measure is one we cannot safely mount into.
   */
  function hasBox(el) {
    if (!el || el.nodeType !== 1) return false;
    try {
      var r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    } catch (e) {
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // PRICE ASSEMBLY
  //
  // The price is NOT in one element. Live probe output, at depth 33, shows it
  // split across three sibling text nodes:
  //
  //   "Current price :"   "$"   "154.00"
  //
  // So no element anywhere on the page has text matching a currency regex, and
  // matching single elements returns nothing no matter how good the regex is.
  // The label is the durable handle: find "Current price", then read FORWARD
  // until an amount has been assembled out of whatever fragments follow.
  //
  // "Avg. per night" is at depth 31, an ANCESTOR of the price rather than a
  // sibling of it, which is why the old marker-counting boundary could not work
  // either. See resolveCard.
  // -------------------------------------------------------------------------

  // The four patterns live on CONFIG.rateCards so they stay the tuning surface
  // when the wording on the page changes. These read them at call time rather
  // than caching, so an override plus __blissOverlay.refresh() takes effect.
  function rxPriceLabel() {
    return CONFIG.rateCards.priceLabelRe;
  }
  function rxPriceLabelInline() {
    return CONFIG.rateCards.priceLabelInlineRe;
  }
  function rxAmount() {
    return CONFIG.rateCards.amountRe;
  }
  function rxPriceShape() {
    return CONFIG.rateCards.priceShapeRe;
  }

  /** How far to widen the forward scan when siblings alone carry no amount. */
  var PRICE_ASSEMBLE_CLIMB = 4;
  /** Spec cap on the card boundary climb. */
  var CARD_BOUNDARY_CLIMB_MAX = 25;

  /**
   * Every "Current price" label under `root`, deepest first.
   *
   * A label's ancestors can also end with the phrase when the price happens to
   * be the last thing in them, so any match that CONTAINS another match is
   * dropped: the innermost element is the real label.
   */
  function findPriceLabels(root) {
    var all = deepQueryAll(root || document, "*");
    var hits = [];
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el.hasAttribute(BADGE_ATTR)) continue;
      if (!rxPriceLabel().test(normText(el))) continue;
      hits.push(el);
    }
    var out = [];
    for (var j = 0; j < hits.length; j++) {
      var isOuter = false;
      for (var k = 0; k < hits.length; k++) {
        if (k !== j && deepContains(hits[j], hits[k])) isOuter = true;
      }
      if (!isOuter) out.push(hits[j]);
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
   * Pass 2 is what covers the case where "$" and "154.00" are not siblings of
   * the label but cousins under a shared wrapper.
   *
   * Label-agnostic: `labelInlineRe` says which phrase to split on, so the same
   * assembly serves the rate cards' "Current price" and the checkout panel's
   * "Total Reservation". Both fragment the amount away from its currency
   * symbol, so both need the same forward scan rather than a regex on one node.
   */
  function assembleAmountAfterLabel(labelEl, labelInlineRe) {
    if (!labelEl) return null;
    var buf = "";
    var sib = labelEl.nextElementSibling;
    for (var n = 0; sib && n < 12; n++) {
      buf += " " + normText(sib);
      var m = rxAmount().exec(buf);
      if (m) return { cents: parseMoneyTextToCents(m[0]), text: m[0] };
      sib = sib.nextElementSibling;
    }

    var node = labelEl;
    for (var d = 0; d < PRICE_ASSEMBLE_CLIMB; d++) {
      var parent = parentAcrossShadow(node);
      if (!parent || parent.nodeType !== 1) break;
      var whole = normText(parent);
      var split = labelInlineRe.exec(whole);
      if (split) {
        var after = whole.slice(split.index + split[0].length);
        var mm = rxAmount().exec(after);
        if (mm) return { cents: parseMoneyTextToCents(mm[0]), text: mm[0] };
      }
      node = parent;
    }
    return null;
  }

  /** The rate-card case: the amount after a "Current price" label. */
  function assemblePriceAfterLabel(labelEl) {
    return assembleAmountAfterLabel(labelEl, rxPriceLabelInline());
  }

  /**
   * Fallback price assembly for a card with no "Current price" label.
   *
   * Finds the element sitting at the price position (its own text carries a
   * currency symbol or a bare amount fragment), then concatenates that element
   * with its immediate siblings into one string and reads the amount out of the
   * combination. Concatenating is the whole point: the fragments only form an
   * amount together.
   *
   * Struck-through candidates are skipped, so a discounted rate is read at the
   * price the guest actually pays rather than the crossed-out one.
   */
  function assemblePriceFallback(card) {
    var all = deepQueryAll(card, "*");
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el.hasAttribute(BADGE_ATTR)) continue;
      if (el.children && el.children.length) continue;
      if (el.shadowRoot) continue;
      var own = normText(el);
      if (!own) continue;
      if (!/[$£€¥₹]/.test(own) && !/\d/.test(own)) continue;
      if (isStruckThrough(el, card)) continue;

      // The element's OWN text first. Widening is only for the split-fragment
      // case, and reaching for siblings when the element already holds a whole
      // amount is what let a struck-through original win: on a discounted rate
      // the previous sibling is the crossed-out price, so "$ 219.00 $ 179.00"
      // regexed to 219.00 and quoted a price the guest is not being offered.
      var m = rxAmount().exec(own);
      if (m) return { cents: parseMoneyTextToCents(m[0]), text: m[0] };

      // Widen to the immediate siblings, skipping any that are struck through.
      var prev = el.previousElementSibling;
      var next = el.nextElementSibling;
      var combined =
        (prev && !isStruckThrough(prev, card) ? normText(prev) + " " : "") +
        own +
        (next && !isStruckThrough(next, card) ? " " + normText(next) : "");
      m = rxAmount().exec(combined);
      if (m) return { cents: parseMoneyTextToCents(m[0]), text: m[0] };
    }
    return null;
  }

  /**
   * The card's price, in integer cents, however it is fragmented.
   *
   * Re-run from the card on every recompute rather than cached, so a re-render
   * that swaps the fragments out does not leave a stale figure on screen.
   */
  function assembleCardPrice(card) {
    if (!card) return null;
    var labels = findPriceLabels(card);
    for (var i = 0; i < labels.length; i++) {
      var got = assemblePriceAfterLabel(labels[i]);
      if (got && got.cents != null) {
        got.source = "current-price-label";
        return got;
      }
    }
    var fb = assemblePriceFallback(card);
    if (fb && fb.cents != null) {
      fb.source = "fragment-fallback";
      return fb;
    }
    return null;
  }

  /**
   * Card anchors: the elements card discovery starts climbing from.
   *
   * "Current price" labels are the primary handle, because a label is exactly
   * one per rate and sits right beside the number. When a page carries none,
   * the deepest elements holding "Avg. per night" stand in, so the fallback
   * price assembly still has somewhere to start.
   */
  function findCardAnchors(root) {
    var labels = findPriceLabels(root || document);
    if (labels.length) return labels;

    var all = deepQueryAll(root || document, "*");
    var marker = CONFIG.rateCards.nightlyMarkerRe;
    var hits = [];
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el.hasAttribute(BADGE_ATTR)) continue;
      if (!marker.test(normText(el))) continue;
      hits.push(el);
    }
    var out = [];
    for (var j = 0; j < hits.length; j++) {
      var isOuter = false;
      for (var k = 0; k < hits.length; k++) {
        if (k !== j && deepContains(hits[j], hits[k])) isOuter = true;
      }
      if (!isOuter) out.push(hits[j]);
    }
    return out;
  }

  /**
   * The card that owns an anchor.
   *
   * Climbs, crossing shadow boundaries, until an ancestor's deep text contains
   * ALL THREE of: a price-shaped string, "Avg. per night", and "additional
   * taxes and fees per night". That conjunction is the card.
   *
   * This replaces marker COUNTING, which could not work here. Counting assumed
   * the marker was a sibling of the price so that picking up a second marker
   * meant crossing into a second card. On this page "Avg. per night" is an
   * ANCESTOR of the price (depth 31 against the price's 33), so the count is
   * already 1 at the first level examined and the climb stopped inside the
   * price block every time.
   *
   * SECOND PASS, at two of the three: a card missing the taxes line would
   * otherwise be dropped outright, which would also make the "Avg. per night"
   * injection fallback below unreachable. Price plus marker still identifies a
   * rate; only the preferred injection point is missing.
   */
  function resolveCard(anchorEl) {
    var cfg = CONFIG.rateCards;
    var doc = (anchorEl && anchorEl.ownerDocument) || document;
    var twoOfThree = null;
    var node = anchorEl;

    for (var d = 0; d < CARD_BOUNDARY_CLIMB_MAX; d++) {
      node = parentAcrossShadow(node);
      if (!node || node.nodeType !== 1) break;
      if (node === doc.body || node === doc.documentElement) break;
      var t = normText(node);

      // CARDINALITY STOP. Two "Current price" labels, or two "Avg. per night"
      // markers, means this ancestor holds more than one rate, so it is the
      // list and not a card. Without this the climb sails past a card that is
      // missing the taxes line and settles on the container holding every card:
      // all three rates then collapse into one "card" quoting the first room's
      // name and price, and the teaser injected for it lands inside a different
      // room's shadow root. The three-way text test alone cannot catch that,
      // because a container full of cards satisfies all three conditions.
      //
      // Both counts, not just the label: a page with no "Current price" labels
      // at all reaches the fallback price assembly, and there the label count is
      // 0 everywhere and would never stop the climb.
      if (countPriceLabels(t) > 1) break;
      if (countMarkers(t) > 1) break;

      if (!rxPriceShape().test(t)) continue;
      if (!cfg.nightlyMarkerRe.test(t)) continue;
      if (cfg.injectAfterRe.test(t)) return node;
      if (!twoOfThree) twoOfThree = node;
    }
    return twoOfThree;
  }

  /** How many "Current price" labels appear in an already-normalised string. */
  function countPriceLabels(text) {
    var re = new RegExp(CONFIG.rateCards.priceLabelInlineRe.source, "gi");
    var m = String(text || "").match(re);
    return m ? m.length : 0;
  }

  /** How many "Avg. per night" markers appear in an already-normalised string. */
  function countMarkers(text) {
    var re = new RegExp(CONFIG.rateCards.nightlyMarkerRe.source, "gi");
    var m = String(text || "").match(re);
    return m ? m.length : 0;
  }

  /**
   * The room name: the nearest preceding heading.
   *
   * A heading INSIDE the card wins, because that is the room's own title. Only
   * when the card carries none does this walk backwards through the document
   * for the heading the card sits under.
   */
  var HEADING_SEL = 'h1,h2,h3,h4,h5,h6,[role="heading"]';

  function findRoomName(card) {
    if (!card) return null;
    // Deep: the room title is usually rendered by the same component, so it
    // sits in a shadow root rather than in the card's light DOM.
    var inside = deepQueryAll(card, HEADING_SEL);
    for (var i = 0; i < inside.length; i++) {
      var t = normText(inside[i]);
      if (t) return t.slice(0, 80);
    }

    var doc = card.ownerDocument || document;
    var node = card;
    var guard = 0;
    while (node && guard++ < 40) {
      var prev = node.previousElementSibling;
      while (prev) {
        var found = lastHeadingWithin(prev);
        if (found) return found.slice(0, 80);
        prev = prev.previousElementSibling;
      }
      node = parentAcrossShadow(node);
      if (!node || node.nodeType !== 1 || node === doc.body) break;
    }
    return null;
  }

  /** The LAST heading inside a subtree, which is the nearest one preceding. */
  function lastHeadingWithin(el) {
    var hs = deepQueryAll(el, HEADING_SEL);
    for (var i = hs.length - 1; i >= 0; i--) {
      var t = normText(hs[i]);
      if (t) return t;
    }
    return null;
  }

  /**
   * The card's displayed nightly price, in cents. Re-resolved from the card on
   * every recompute rather than cached, so a re-render that swaps the price
   * node out does not leave a stale figure on screen.
   *
   * Skips a struck-through figure: a discounted rate renders the original first,
   * and taking it would quote a price the guest is not being offered.
   */
  function scrapeNightlyCents(card) {
    if (!card || !card.isConnected) return null;
    var got = assembleCardPrice(card);
    if (!got) return null;
    rememberCurrencyHint(normText(card));
    return got.cents;
  }

  /**
   * Per-card amount. Same return shape as mews-overlay.js resolveCardAmount,
   * minus the ga4_RatesLoaded branch: iHotelier publishes no rates array, so
   * the scrape is the only source rather than the fallback.
   */
  function resolveCardAmount(card, dl) {
    if (!card) return null;
    var name = findRoomName(card);
    if (CONFIG.rateCards.excludeRatePattern && CONFIG.rateCards.excludeRatePattern.test(name || "")) {
      return null;
    }
    var raw = scrapeNightlyCents(card);
    var cents = toStayTotalCents(raw, dl);
    if (cents == null) return null;
    return {
      amountCents: cents,
      nightlyAmountCents: toNightlyCents(raw, dl),
      currency: null,
      rateId: null,
      rateName: name,
      source: "scrape",
    };
  }

  // =========================================================================
  // HOST THEME SAMPLING — unchanged from mews-overlay.js
  //
  // Booking engines are themed per property, so read the live page rather than
  // shipping a palette. Only the TRIGGER samples; the modal stays Bliss violet.
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

    // Accent: the most saturated opaque button background on the page, which on
    // a booking engine is almost always the primary CTA.
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

    // Surface: prefer an opaque card-ish container, else the body background.
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
  // FORMATTING — unchanged from mews-overlay.js
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
  //   1. Rate-card teasers. One per room card, inserted as a full-width block
  //      sibling after the "additional taxes and fees per night" line, in normal
  //      flow. No host node is wrapped, moved, reparented or restyled. The only
  //      mutation is one added child, which a re-render may discard and the
  //      observer then re-adds.
  //   2. One shared modal, mounted hidden and shown only on click. Until the
  //      guest clicks a teaser, nothing of ours covers host content.
  //
  // Every injected node owns its own shadow root, so host CSS cannot reach in
  // and ours cannot leak out.
  // =========================================================================

  var LEGACY_HOST_ID = "bliss-plan-overlay-host";
  var SUMMARY_HOST_ID = "bliss-plan-summary-host";
  var MODAL_HOST_ID = "bliss-plan-modal-host";
  var BADGE_ATTR = "data-bliss-badge";
  var DECORATED_ATTR = "data-bliss-plan"; // marks a card already injected into
  var POSITIONED_ATTR = "data-bliss-positioned";

  var state = {
    dl: null, // the stay, in readDataLayer's shape (see readStay)
    theme: null,
    currencyHint: null,
    // The confirmed plan for this stay, session-level rather than per-trigger.
    planChoice: null,
    triggers: [], // {id, kind, cardEl, hostEl, root, amountCents, preview, confirmed}
    modal: null, // {triggerId, selected} while open
    nextId: 1,
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
   * is only one document now, so the render functions stay diffable against
   * mews-overlay.js.
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
    // The modal is the one node still mounted in the top document, so a plain
    // getElementById is right for these three.
    [LEGACY_HOST_ID, SUMMARY_HOST_ID, MODAL_HOST_ID].forEach(function (id) {
      var el = doc.getElementById(id);
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });
    // Teasers and the attributes marking decorated cards live inside the
    // component's shadow roots, so these three sweeps have to go deep or a
    // re-paste leaves every previous teaser on the page.
    deepQueryAll(doc, "[" + BADGE_ATTR + "]").forEach(function (el) {
      if (el.parentNode) el.parentNode.removeChild(el);
    });
    deepQueryAll(doc, "[" + DECORATED_ATTR + "]").forEach(function (el) {
      el.removeAttribute(DECORATED_ATTR);
    });
    deepQueryAll(doc, "[" + POSITIONED_ATTR + "]").forEach(function (el) {
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
        if (typeof prev.__unobserve === "function") prev.__unobserve();
      } catch (e) {
        /* ignore */
      }
      try {
        delete window.__blissOverlay;
      } catch (e) {
        /* ignore */
      }
    }
    stripInjectedDom();
  }

  destroyExisting();

  // -------------------------------------------------------------------------
  // STYLES — unchanged from mews-overlay.js
  // -------------------------------------------------------------------------

  function baseCss(theme) {
    return ":host{all:initial}" + "*{box-sizing:border-box;margin:0;padding:0;font-family:" + theme.font + "}";
  }

  function triggerCss(theme) {
    var violet = CONFIG.brand.violet;
    var ink = CONFIG.brand.ink;
    var inkMuted = CONFIG.brand.inkMuted;
    var radius = CONFIG.brand.radius;
    return (
      baseCss(theme) +
      // In-card: plain text on its own line. No border, background, radius,
      // shadow or padding — the outlined pill read as another of the host's
      // controls sitting next to its real ones.
      //
      // display:block with inline children, NOT flex. Flex items do not wrap
      // internally, so the amount ran past the card edge and clipped
      // "installments". Inline content wraps mid-phrase, which is why a long
      // line now takes a second row instead of being cut off. A button element
      // also needs its UA background and border explicitly cleared.
      // RIGHT-ALIGNED. On the Ayres cards the price, "Avg. per night" and
      // "additional taxes and fees per night" are all flush right, and the
      // teaser sitting under them flush left read as a stray line.
      //
      // width:100% is what makes text-align:right do anything at all: a
      // <button> uses shrink-to-fit sizing even at display:block, so without a
      // definite width the box hugs its own text and right-aligning inside a
      // box exactly as wide as its text is a no-op. margin-left:auto is belt
      // and braces for the case where the host card is a flex or grid parent
      // and the percentage width resolves against something unexpected: the box
      // is then pushed right as a box. Same fix .details .link already used.
      ".trig{display:block;width:100%;margin:0 0 0 auto;padding:0;background:none;border:0;" +
      "border-radius:0;box-shadow:none;color:" + ink + ";font-size:12px;line-height:1.45;" +
      "cursor:pointer;text-align:right;white-space:normal;overflow-wrap:break-word}" +
      ".trig:hover .amt{text-decoration:underline}" +
      ".trig:focus-visible{outline:2px solid " + violet + ";outline-offset:2px}" +
      // Glyph is white, not ink: white is the label colour on every amethyst
      // fill, and the tick is a fill of exactly that kind. Reads from
      // BLISS_COLORS rather than CONFIG.brand so the confirmed tick and the
      // modal CTA cannot drift apart, which is what left it on the deep purple
      // after the modal moved to amethyst.
      ".tick{display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;" +
      "border-radius:" + radius + ";background:" + BLISS_COLORS.amethyst + ";color:" + BLISS_COLORS.white + ";font-size:10px;" +
      "margin-right:7px;vertical-align:middle}" +
      ".sep{margin:0 5px;opacity:.55}" +
      ".amt{font-weight:600}" +
      // Supporting line under the rate-card main line. display:block is what
      // puts it on its own row beneath the inline main line. width:100% plus an
      // explicit text-align:right so this line tracks the main line rather than
      // relying on inheritance alone.
      ".sub{display:block;width:100%;margin-top:2px;font-size:11px;font-weight:400;text-align:right;" +
      "color:" + inkMuted + "}" +
      // "See details" reads as a link beneath the main line, not as another
      // button competing with the host's own control.
      ".link{display:block;margin-top:3px;padding:0;background:none;border:0;font-size:11px;" +
      "font-weight:600;color:" + ink + ";text-decoration:underline;cursor:pointer;text-align:left}" +
      // Details block: LEFT-aligned. It now sits as the first child of the
      // consent wrapper, in a column of checkbox rows that are all flush left,
      // where the old right alignment read as a stray line. The rate-card
      // teaser keeps text-align:right from .trig above, which is correct
      // against the cards' right-aligned prices; only this block moves.
      //
      // Declared AFTER .trig and .link so it wins on order at equal
      // specificity. Sets colour explicitly because State A's container is not
      // a .trig and would otherwise inherit the initial black from
      // :host{all:initial}.
      // Spacing: the block sits at the top of the payment section, between the
      // Travel Protection panel above and the card brand logos below.
      //
      // The two margins are deliberately UNEQUAL. Equal margins did not produce
      // equal gaps: the logos below carry their own leading, so 16px on each
      // side rendered tight under the panel with a large gap beneath. 28px on
      // top against 16px underneath is what makes the two visible gaps read as
      // the same, which is the thing being centred here.
      ".details{text-align:left;color:" + ink + ";margin-top:28px;margin-bottom:16px;line-height:1.5}" +
      // EXPLICIT TYPE SCALE, no longer sampled off the anchor. Sampling gave
      // 16px/600, the total's display scale, which was far too heavy here.
      // 15px, up from 13px: the surrounding checkbox labels are larger than
      // first measured and 13px read as fine print next to them. Weight 700 so
      // the main line carries against the panel headings around it.
      ".details .amt{font-size:15px;font-weight:700}" +
      ".details .sub{font-size:11px;font-weight:400;text-align:left;margin-top:2px}" +
      // Left-aligned to match, and the auto margin that used to push the box
      // right is gone. width:fit-content stays: a <button> is shrink-to-fit
      // even at display:block, so this keeps the underline hugging the text
      // rather than spanning the wrapper.
      ".details .link{display:block;width:fit-content;margin-left:0;margin-right:auto;text-align:left}" +
      ".trig[disabled]{cursor:default}"
    );
  }

  /**
   * The modal is the one surface that does NOT take the sampled host palette.
   * Sampling made it wear the property's brand, which read as the hotel
   * speaking rather than Bliss. Only `theme` for the FONT is still consulted
   * (via baseCss), so the modal sits in the page's typography while staying in
   * Bliss colours.
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
      // Fine print under the summary line, tracking the step's basis.
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
      // muted ink the schedule uses for its secondary column. One line per row,
      // so there is no .n/.d/.v split to mirror.
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
      // composited to a pale tint under white text, which is both a failing
      // pair and a tint-only colour used as a fill. Declared after .cta:hover,
      // which it ties with on specificity, so a disabled pill cannot light up
      // on hover.
      ".cta[disabled]{background:" + c.hairline + ";color:" + c.muted + ";cursor:default}" +
      ".note{font-size:11px;color:" + c.muted + ";margin-top:10px;line-height:1.45}" +
      ".msg{font-size:12px;color:" + c.muted + ";line-height:1.5}" +
      // The receipt's subject line. 14px matches the option row's amount, the
      // largest thing in the body it replaces.
      ".plan{margin:2px 0 0;font-size:14px;font-weight:600;line-height:1.4;color:" + c.ink + "}" +
      // Primary ink, and ruled off the disclaimer list above it with the same
      // hairline .disc uses above Payment schedule, so it reads as a change of
      // state rather than a fourth disclaimer.
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
      // sampled host font, and this rule outranks that `*` selector. Keep these
      // three values in step with the port's `.pwr .wm` + BlissWordmark.
      ".pwr .wm{font-family:Georgia,serif;font-weight:700;color:" + c.amethyst + "}" +
      // Below the phone breakpoint the modal becomes a bottom sheet.
      "@media (max-width:420px){.scrim{align-items:flex-end;padding:0}" +
      ".bliss-card{width:100%;max-width:100%;max-height:88vh;border-radius:" + b.radiusCard + " " + b.radiusCard + " 0 0}}"
    );
  }

  // -------------------------------------------------------------------------
  // PLAN MATH PER TRIGGER — unchanged from mews-overlay.js
  // -------------------------------------------------------------------------

  function computeFor(amountCents) {
    var amount = amountCents == null ? 0 : amountCents;
    if (!state.dl || state.dl.checkin == null || amountCents == null) {
      return ineligible("invalid_input", 0, 0, amount, amount);
    }
    return previewEligibility(startOfToday(), state.dl.checkin, amount, CONFIG.rules);
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
   * The "from $X" figure on the closed trigger. Monthly is the headline because
   * it is the smallest regular commitment; when the merchant's rules only allow
   * bi-weekly, the label says so rather than quoting a monthly number that is
   * not on offer.
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

    // Rate cards quote a per-night teaser off the card's own displayed price,
    // divided by the payment count that yields the SMALLEST per-payment figure
    // — biweekly where offered, otherwise whichever eligible option has the
    // most payments. That is what keeps the quoted figure truthful: no other
    // cadence produces a lower number.
    //
    // The numerator is the scraped tax-exclusive nightly price, so this figure
    // deliberately does not reconcile with the modal. The modal continues to
    // quote the real per-payment amounts off the stay total; only the teaser is
    // per-night.
    if (t.kind === "rate-card" && t.scrapedNightlyCents != null) {
      var spread = optionByFrequency(preview, "biweekly");
      if (!spread) {
        spread = preview.options[0];
        for (var j = 1; j < preview.options.length; j++) {
          if (preview.options[j].numPayments > spread.numPayments) spread = preview.options[j];
        }
      }
      var perNight = Math.round(t.scrapedNightlyCents / spread.numPayments);
      return "or " + money(perNight, cur(t)) + "/night over time";
    }

    var unit = opt.frequency === "monthly" ? "/mo" : " every 2 weeks";
    return "from " + money(opt.perPaymentAmountCents, cur(t)) + unit;
  }

  /**
   * State B's figure on the details step: the tax- and fee-inclusive per-night
   * amount, off the tax-inclusive Total Reservation figure.
   */
  function detailsLine(t) {
    var preview = t.preview;
    if (!preview || !preview.eligible || !preview.options.length) return null;
    var spread = optionByFrequency(preview, "biweekly");
    if (!spread) {
      spread = preview.options[0];
      for (var i = 1; i < preview.options.length; i++) {
        if (preview.options[i].numPayments > spread.numPayments) spread = preview.options[i];
      }
    }
    var nights = state.dl ? state.dl.nights : null;
    var perNight = summaryPerNightCents(t.detailsTotalCents, nights, spread.numPayments);
    if (perNight == null) return null;
    return "Pay installments over time starting at " + money(perNight, cur(t)) + "/night";
  }

  // -------------------------------------------------------------------------
  // TRIGGER — markup and copy unchanged from mews-overlay.js
  // -------------------------------------------------------------------------

  var reportedFont = false;

  function reportDetailsFont(face) {
    if (reportedFont) return;
    reportedFont = true;
    console.info(
      "[bliss] details block typography — sampled theme.font: " +
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

    var kids;
    if (t.kind === "details") {
      // :host{all:initial} severs inheritance, so the block cannot pick up the
      // host font on its own. FAMILY ONLY is read off the anchor, which is the
      // placement target: enough to sit in the section's typography.
      //
      // Size and weight are deliberately NOT applied from the sample any more.
      // They were, and the block inherited whatever the anchor happened to be:
      // once the amount anchor became the total's money element that meant 16px
      // weight 600, a display scale sitting in a row of checkbox labels. They
      // are set explicitly in triggerCss under .details instead, so the result
      // is the same wherever the block is placed.
      var face = null;
      try {
        var ref = (t.anchorEl && t.anchorEl.isConnected && t.anchorEl) || t.hostEl.parentNode;
        if (ref && ref.nodeType === 1) {
          var rcs = ownerWin(ref).getComputedStyle(ref);
          face = { family: rcs.fontFamily, size: rcs.fontSize, weight: rcs.fontWeight };
        }
      } catch (e) {
        face = null;
      }
      if (face && face.family) {
        root.appendChild(h("style", { text: "*{font-family:" + face.family + "}" }));
      }
      reportDetailsFont(face);

      var block;
      if (state.planChoice) {
        // STATE A — a plan was already selected on a rate card.
        block = h("div", { class: "details" }, [
          h("span", { class: "amt", text: "You've selected installment payments" }),
          h("button", {
            class: "link",
            type: "button",
            text: "See details",
            onClick: function (ev) {
              ev.preventDefault();
              ev.stopPropagation();
              openModal(t.id);
            },
          }),
        ]);
      } else {
        // STATE B — nothing selected. No "Pre-tax" on the supporting line:
        // unlike the rate-card figure this one includes tax.
        var dLine = detailsLine(t);
        if (!dLine) {
          // Nothing to show. Say WHY, then take the host back out of the page.
          //
          // It used to just set display:none, which left a 0x0 node with a
          // shadow root holding two stylesheets and no content sitting in the
          // host's reservation panel. Invisible, but real: it accumulated, it
          // measured as a mounted block, and it made a failure that has a
          // specific cause look like a rendering bug.
          reportDetailsSuppressed(t);
          // THE HOLE IN THE LAST FIX. This path removes the block, and until
          // now it armed nothing, so recovery depended entirely on some later
          // DOM mutation happening to arrive. On a settled page none does.
          //
          // A null total is transient: the payment section is mid-render, the
          // amount could not be read this pass, and the block should come back.
          // A total that DID read and was then rejected on eligibility is
          // settled, and retrying it would mount and remove on a loop.
          if (t.detailsTotalCents == null && detailsAnchorPresent()) {
            detailsSettledEmpty = false;
            scheduleDetailsRecheck();
          } else {
            detailsSettledEmpty = true;
          }
          removeDetailsTrigger(t);
          return;
        }
        block = h(
          "button",
          {
            class: "trig details",
            type: "button",
            "aria-haspopup": "dialog",
            onClick: function (ev) {
              ev.preventDefault();
              ev.stopPropagation();
              openModal(t.id);
            },
          },
          [h("span", { class: "amt", text: dLine }), h("span", { class: "sub", text: "No credit check" })]
        );
      }
      t.hostEl.style.display = "block";
      root.appendChild(block);
      // The block can be mounted, populated and still have no box, so measure
      // rather than assume. See verifyDetailsPlacement.
      verifyDetailsPlacement(t);
      return;
    }

    var cOpt = confirmedOption(t);
    if (cOpt) {
      // The count and the per-payment amount used to sit on this line. They are
      // dropped: the modal already states them, and it is one click away.
      kids = [
        h("span", { class: "tick", text: "✓" }),
        h("span", { text: "Payment plan selected" }),
      ];
    } else {
      var line = fromLine(t);
      if (!line) {
        // Nothing worth showing. Stay invisible rather than explain ourselves on
        // top of the host page.
        t.hostEl.style.display = "none";
        return;
      }
      if (t.kind === "rate-card" && t.scrapedNightlyCents != null) {
        // The supporting line is gated on the scrape, not just on the kind: it
        // describes the scraped tax-exclusive figure, so if fromLine fell
        // through to a generic line the "Pre-tax" claim would be false and the
        // line is omitted rather than shown against the wrong basis.
        kids = [
          h("span", { class: "amt", text: line }),
          h("span", { class: "sub", text: "Pre-tax · No credit check" }),
        ];
      } else {
        kids = [
          h("span", { text: "Spread this stay over time" }),
          h("span", { class: "sep", text: "·" }),
          h("span", { class: "amt", text: line }),
        ];
      }
    }
    t.hostEl.style.display = "block";

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
  }

  function renderAllTriggers() {
    // Iterate a COPY: renderTrigger can mark a trigger for removal, and
    // mutating the live array mid-forEach skips entries.
    state.triggers.slice().forEach(renderTrigger);
    var dropping = false;
    for (var i = 0; i < state.triggers.length; i++) {
      if (state.triggers[i].__remove) dropping = true;
    }
    if (dropping) {
      state.triggers = state.triggers.filter(function (t) {
        return !t.__remove;
      });
    }
  }

  /**
   * Takes the checkout block back out of the page when it has nothing to show.
   *
   * The trigger is flagged rather than spliced here, because this runs inside
   * the render loop; renderAllTriggers does the actual removal once the loop is
   * done. A later sync re-mounts the block from scratch if the stay or the
   * total changes into something eligible, so this is not a one-way door.
   */
  function removeDetailsTrigger(t) {
    t.__remove = true;
    if (t.hostEl && t.hostEl.parentNode) t.hostEl.parentNode.removeChild(t.hostEl);
    if (t.rowEl && t.rowEl.removeAttribute) t.rowEl.removeAttribute(DECORATED_ATTR);
    if (state.modal && state.modal.triggerId === t.id) closeModal();
  }

  /**
   * The block is mounted and populated. Does it actually occupy space?
   *
   * "Mounted" and "visible" are different claims, and the checkout block can
   * satisfy the first while failing the second: a host inserted into a table
   * row, a nowrap flex row, or a collapsed container renders its shadow content
   * into a box of zero size. Nothing in the render path notices, which is why
   * the console could report a mounted block over an empty spot on the page.
   *
   * REPORTS, DOES NOT RELOCATE. It used to move the host one container further
   * out on each zero measurement, up to four times. That ladder is gone: it was
   * written for a block anchored by text, which could legitimately land in a
   * collapsed container, and it is the thing that carried the block out of the
   * summary card and onto the page background. The anchor is now required to
   * have a box before anything mounts (see resolveDetailsAnchor and hasBox), so
   * a zero measurement here means the placement rules themselves are wrong and
   * the fix belongs in findDetailsRow or chooseDetailsSlot, not in a runtime
   * scramble that lands the block somewhere arbitrary.
   */
  function verifyDetailsPlacement(t) {
    if (!t.hostEl || !t.hostEl.isConnected) return;
    var rect;
    try {
      rect = t.hostEl.getBoundingClientRect();
    } catch (e) {
      return;
    }
    if (rect.width > 0 && rect.height > 0) {
      t.__placementTries = 0;
      return;
    }

    t.__placementTries = (t.__placementTries || 0) + 1;
    if (t.__placementTries > 1) return;

    logDetailsPlacement(t, rect);
    console.warn(
      "[bliss] checkout block measures 0x0. REPORTING ONLY, it has not been moved. " +
        "The ancestor dump above shows which container is collapsing it."
    );
  }

  /**
   * Everything needed to tell the three placement failures apart, in one dump:
   * the host's own box and computed style, its shadow root's contents, and the
   * computed style of every ancestor up to and including the shadow host.
   */
  function logDetailsPlacement(t, rect) {
    var lines = [];
    var host = t.hostEl;
    var sr = host.shadowRoot;

    lines.push("[bliss] checkout block is mounted but measures 0x0. Placement dump:");
    lines.push(
      "  host box: " + Math.round(rect.width) + "x" + Math.round(rect.height) +
        "  |  inline display: " + JSON.stringify(host.style.display)
    );

    // 2. Is the shadow root populated, or stylesheets only?
    var kids = sr ? [].slice.call(sr.childNodes) : [];
    lines.push(
      "  shadowRoot: innerHTML length " + (sr ? sr.innerHTML.length : -1) +
        ", childNodes " + kids.length +
        " [" + kids.map(function (n) {
          return n.nodeType === 1 ? n.tagName.toLowerCase() : "#" + n.nodeType;
        }).join(", ") + "]"
    );
    lines.push(
      "  shadowRoot text: " + JSON.stringify(
        String((sr && sr.textContent) || "").replace(/\s+/g, " ").trim().slice(0, 80)
      )
    );
    var btn = sr ? sr.querySelector(".trig, .details") : null;
    if (btn) {
      var br = btn.getBoundingClientRect();
      lines.push(
        "  inner control box: " + Math.round(br.width) + "x" + Math.round(br.height) +
          "  |  text: " + JSON.stringify(btn.textContent.replace(/\s+/g, " ").trim().slice(0, 60))
      );
    } else {
      lines.push("  inner control: ABSENT (shadow root holds stylesheets only)");
    }

    // 3. Where did it land, relative to the row we meant to sit under?
    lines.push(
      "  slot (inserted after): <" +
        (t.slotEl && t.slotEl.tagName ? t.slotEl.tagName.toLowerCase() : "?") + ">" +
        "  |  Total Reservation row: <" +
        (t.rowEl && t.rowEl.tagName ? t.rowEl.tagName.toLowerCase() : "?") + ">" +
        "  |  slot is the row: " + (t.slotEl === t.rowEl)
    );

    // 1. Ancestor chain, so a collapsed container is visible by inspection.
    var node = host;
    for (var d = 0; node && d < 12; d++) {
      var cs = null;
      try {
        cs = ownerWin(node).getComputedStyle(node);
      } catch (e) {
        cs = null;
      }
      var r = null;
      try {
        r = node.getBoundingClientRect();
      } catch (e) {
        r = null;
      }
      lines.push(
        "  [" + d + "] <" + (node.tagName || "?").toLowerCase() + ">" +
          (node === host ? " (our host)" : "") +
          "  box " + (r ? Math.round(r.width) + "x" + Math.round(r.height) : "?") +
          (cs
            ? "  display:" + cs.display +
              " visibility:" + cs.visibility +
              " overflow:" + cs.overflow +
              " height:" + cs.height +
              " maxHeight:" + cs.maxHeight +
              " width:" + cs.width +
              " opacity:" + cs.opacity +
              " position:" + cs.position
            : "  (style unreadable)")
      );
      var parent = node.parentNode;
      if (parent && isShadowRoot(parent)) {
        lines.push(
          "  --- shadow boundary, host is <" +
            (parent.host && parent.host.tagName ? parent.host.tagName.toLowerCase() : "?") + "> ---"
        );
      }
      node = parentAcrossShadow(node);
      if (!node || node.nodeType !== 1) break;
    }

    console.warn(lines.join("\n"));
  }

  // One-shot per distinct failure state, so a per-mutation sync cannot spam.
  var lastDetailsSuppressKey = null;

  /**
   * Why the checkout block rendered nothing.
   *
   * Prints every input the teaser line depends on, so the three candidate
   * causes are told apart at a glance rather than inferred: an ineligible
   * preview, a missing nights or options value, or an unassembled total.
   */
  function reportDetailsSuppressed(t) {
    var p = t.preview;
    var nights = state.dl ? state.dl.nights : null;
    var key = [
      p && p.eligible,
      p && p.reason,
      p ? p.options.length : -1,
      nights,
      t.detailsTotalCents,
      t.amountCents,
    ].join("|");
    if (key === lastDetailsSuppressKey) return;
    lastDetailsSuppressKey = key;

    var why;
    if (t.detailsTotalCents == null) {
      why =
        'the "Total Reservation" amount could not be assembled, so there is no basis to plan against. ' +
        "Check CONFIG.detailsStep.anchorRe and CONFIG.rateCards.amountRe.";
    } else if (!p) {
      why = "no eligibility preview was computed for this block.";
    } else if (!p.eligible) {
      why =
        "the merchant's plan rules reject this basis: " + p.reason + ". " +
        (REASON_COPY[p.reason] || "") +
        "\n     NOTE: the checkout block and the rate cards are gated on DIFFERENT bases. " +
        "The cards use the pre-tax stay total; this block uses the tax-inclusive total plus the " +
        "Bliss fee, which is a larger number. An amount or lead-time limit in the rules can " +
        "therefore reject this block while the cards still show a teaser.";
    } else if (!p.options.length) {
      why = "the preview is eligible but no cadence fits between today and check-in.";
    } else if (nights == null || nights <= 0) {
      why =
        "the nights count is unknown, and the block quotes a per-night figure, so the line cannot " +
        "be computed. Check __blissOverlay.stay().";
    } else {
      why = "summaryPerNightCents returned null for total=" + t.detailsTotalCents + ", nights=" + nights + ".";
    }

    console.warn(
      "[bliss] checkout block rendered nothing, and has been removed from the page.\n" +
        "  Total Reservation parsed: " +
        (t.detailsTotalCents == null ? "NO" : money(t.detailsTotalCents, cur(t))) + "\n" +
        "  plan basis (total plus the " + Math.round(BLISS_FEE_RATE * 100) + "% Bliss fee): " +
        (t.amountCents == null ? "null" : money(t.amountCents, cur(t))) + "\n" +
        "  stay: " + (state.dl && state.dl.checkinIso) + " to " + (state.dl && state.dl.checkoutIso) +
        ", nights " + nights + "\n" +
        "  eligibility: " +
        (p ? (p.eligible ? "eligible" : "INELIGIBLE (" + p.reason + ")") : "no preview") +
        ", options " + (p ? p.options.length : -1) + "\n" +
        "  plan rules in force: " + CONFIG.rulesSource + "\n" +
        "  -> " + why
    );
  }

  // -------------------------------------------------------------------------
  // MODAL — unchanged from mews-overlay.js apart from mounting in `document`
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
    if (state.dl && state.dl.checkinIso) ctxBits.push(shortDate(state.dl.checkinIso));
    if (state.dl && state.dl.nights != null && state.dl.nights > 0) {
      ctxBits.push(state.dl.nights + (state.dl.nights === 1 ? " night" : " nights"));
    }
    if (t.amountCents != null) ctxBits.push(money(t.amountCents, currency));
    body.appendChild(h("div", { class: "ctx", text: ctxBits.join(" · ") || "Waiting for dates" }));
    // Fine print follows the basis, because the two steps quote different ones.
    body.appendChild(
      h("div", {
        class: "fine",
        text: t.kind === "details" ? "Tax and processing fee included" : "Pre-tax",
      })
    );

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
    body.appendChild(
      h("div", { class: "note", text: "Choose your plan and finish checkout as usual." })
    );

    mountModalCard(h, head, body);
  }

  /**
   * Backs a trigger all the way out of a plan: drops the modal's selection and
   * the recorded confirmation together, so the modal returns to its unselected
   * state and the trigger reverts to its "Spread this stay over time" text.
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
   * durable, and every figure is derived at render.
   */
  function confirmedOption(t) {
    if (!t || !t.confirmed || !t.preview) return null;
    return optionByFrequency(t.preview, t.confirmed.frequency);
  }

  function confirmPlan(t, option) {
    // Frequency and count only — no amount. See confirmedOption.
    //
    // cardKey rides along so recompute can put the confirmation back on the
    // card it was made on after a re-render destroys this trigger. Null on a
    // details trigger, which owns no card, and a null key matches nothing.
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
      // The per-night basis the trigger teased, kept so a recorded choice can be
      // reconciled against what the guest was shown before clicking.
      nightlyAmountCents: t.nightlyAmountCents,
      currency: cur(t),
      source: t.kind, // "rate-card" | "details"
      amountSource: t.amountSource, // "scrape" | null
      rateId: t.rateId || null,
      rateName: t.rateName || t.label || null,
      checkin: state.dl ? state.dl.checkinIso : null,
      checkout: state.dl ? state.dl.checkoutIso : null,
      nights: state.dl ? state.dl.nights : null,
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
    // Session-level, so a later step can show State A after the rate-card
    // trigger that recorded this has been unmounted.
    state.planChoice = t.confirmed;
    if (state.modal) state.modal.justConfirmed = true;
    renderAllTriggers();
    if (CONFIG.closeModalOnConfirm) closeModal();
    else renderModal();
  }

  // -------------------------------------------------------------------------
  // PLACEMENT — rate cards
  // -------------------------------------------------------------------------

  /**
   * Where the teaser goes: immediately after the card's "additional taxes and
   * fees per night" line, which puts it above the "Best Available Rate" line.
   *
   * Returns the DEEPEST element in the card matching that text, so the teaser
   * lands next to the line itself rather than next to a wrapper that happens to
   * contain it along with half the card.
   */
  /**
   * Where the teaser goes: after the "additional taxes and fees per night"
   * line, falling back to the "Avg. per night" line when the card has no taxes
   * line at all.
   *
   * Returns the DEEPEST element matching, so the teaser lands beside the line
   * itself rather than beside a wrapper that merely contains it. The caller
   * inserts as a sibling, which puts the teaser in that element's own tree,
   * shadow root included.
   */
  function findInjectionAnchor(card) {
    return deepestMatch(card, CONFIG.rateCards.injectAfterRe) || deepestMatch(card, CONFIG.rateCards.nightlyMarkerRe);
  }

  function deepestMatch(card, re) {
    var all = deepQueryAll(card, "*");
    var best = null;
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el.hasAttribute(BADGE_ATTR)) continue;
      if (!re.test(normText(el))) continue;
      // Walk down to the deepest match.
      //
      // contains() does NOT cross a shadow boundary, so a host and a match
      // inside its shadow root both report "not contained". deepContains is
      // what keeps the descent working across the component's roots.
      if (best == null || deepContains(best, el)) best = el;
    }
    return best;
  }

  /** contains(), crossing shadow boundaries. Native contains() does not. */
  function deepContains(ancestor, node) {
    if (!ancestor || !node) return false;
    var cur = node;
    for (var d = 0; cur && d < DEEP_MAX_DEPTH * 4; d++) {
      if (cur === ancestor) return true;
      cur = parentAcrossShadow(cur);
    }
    return false;
  }

  /**
   * Normal-flow block, full width. Nothing is positioned, so nothing can
   * overlap host content.
   */
  function styleInlinePill(hostEl) {
    var p = (CONFIG.rateCards && CONFIG.rateCards.placement) || {};
    hostEl.style.display = "block";
    hostEl.style.width = "100%";
    hostEl.style.boxSizing = "border-box";
    hostEl.style.marginTop = (p.marginTopPx == null ? 10 : p.marginTopPx) + "px";
    // Both are inert on a block parent. They matter when the parent is itself a
    // flex or grid container, where they force the teaser onto its own line
    // instead of letting it be squeezed in as another column.
    hostEl.style.flexBasis = "100%";
    hostEl.style.gridColumn = "1 / -1";
  }

  /**
   * Content-derived identity for a rate card, and the thing that lets a
   * confirmed plan find its way back to the right card after iHotelier
   * re-renders the room list.
   *
   * Deliberately NOT DECORATED_ATTR or any other attribute we write. In the
   * case where iHotelier replaces the card ELEMENT rather than its children,
   * every attribute we set went with the old node, so a marker of ours cannot
   * be the key. The card's own rendered content is the only thing that
   * survives both re-render shapes.
   *
   * Composed from the room name, which is what the trigger already scrapes for
   * `label` on the line below and what resolveCardAmount returns again as
   * `rateName`. Those two are the same string on this file, from the same
   * findRoomName call, so there is no second component to add; the price is
   * deliberately left out because it moves when the stay dates change and the
   * key must not.
   *
   * Lowercased so a re-render that recapitalises the title still matches.
   * Returns null for a card with no resolvable title, and a null key never
   * matches anything, so such a card simply does not restore.
   */
  function cardKeyFor(card) {
    var room = findRoomName(card);
    if (!room) return null;
    // findRoomName already returns normText output, so whitespace is collapsed
    // and trimmed by the time it gets here.
    return room.toLowerCase();
  }

  function attachBadge(card, priceEl) {
    if (card.hasAttribute(DECORATED_ATTR)) {
      // The attribute survives a re-render that replaced the card's children,
      // so confirm our node is still in there before trusting it. Deep, because
      // the teaser now lives in a shadow root that querySelector cannot see.
      if (deepQueryAll(card, "[" + BADGE_ATTR + "]").length) return;
      card.removeAttribute(DECORATED_ATTR);
    }
    var hostEl = (card.ownerDocument || document).createElement("div");
    hostEl.setAttribute(BADGE_ATTR, "");
    styleInlinePill(hostEl);
    hostEl.style.display = "none";
    var root = hostEl.attachShadow({ mode: "open" });

    // INSERTED INTO THE ANCHOR'S OWN TREE, which is the shadow root the card
    // renders in, not the top document. insertBefore on the anchor's parentNode
    // is what does that: the parent is a node inside that shadow root, so the
    // teaser joins it as a sibling of the line it belongs under. Putting it in
    // the top document instead would leave it rendering somewhere else on the
    // page entirely, or not at all.
    //
    // The teaser keeps its OWN shadow root and styles regardless of which tree
    // it is mounted in, so the host component's CSS still cannot reach it.
    //
    // Sibling insertion mutates the parent's child list, which a re-render will
    // discard. That is covered: the observer re-runs decorate, and the
    // DECORATED_ATTR guard plus the "is our node still in there" check make
    // re-insertion idempotent rather than duplicating.
    // findInjectionAnchor already falls back from the taxes line to the
    // "Avg. per night" line, so by here `anchor` is whichever of the two the
    // card actually has.
    var anchor = findInjectionAnchor(card);
    var placed = false;
    if (anchor && anchor.parentNode) {
      anchor.parentNode.insertBefore(hostEl, anchor.nextSibling);
      placed = true;
      if (!warnedNoTaxLine && !CONFIG.rateCards.injectAfterRe.test(normText(anchor))) {
        warnedNoTaxLine = true;
        console.warn(
          '[bliss] no "additional taxes and fees per night" line found in a card. ' +
            'Teaser placed after the "Avg. per night" line instead. If the wording on the page has ' +
            "changed, update CONFIG.rateCards.injectAfterRe."
        );
      }
    }
    // Last resort: beside the anchor discovery started from.
    if (!placed && priceEl && priceEl.parentNode) {
      priceEl.parentNode.insertBefore(hostEl, priceEl.nextSibling);
      placed = true;
    }
    if (!placed) card.appendChild(hostEl);

    var t = {
      id: state.nextId++,
      kind: "rate-card",
      cardEl: card,
      hostEl: hostEl,
      root: root,
      label: findRoomName(card),
      // Frozen at build time and never recomputed. recompute() overwrites
      // `label` with rateName, so keying off that field would give the same
      // card a different key before and after the first recompute and the
      // match would never land.
      cardKey: cardKeyFor(card),
      amountCents: null,
      nightlyAmountCents: null,
      scrapedNightlyCents: null,
      currency: null,
      rateId: null,
      rateName: null,
      amountSource: null,
      preview: null,
      confirmed: null,
    };
    card.setAttribute(DECORATED_ATTR, String(t.id));
    state.triggers.push(t);
  }

  var warnedNoTaxLine = false;

  // Last reported card set, so a per-mutation sync logs only on a real change.
  var lastCardReport = null;

  /**
   * Finds every room card and decorates it.
   *
   * Label-first: each "Current price" label resolves to its card, deduped by
   * card so a discounted rate showing two figures still gets one teaser.
   */
  function decorateRateCards() {
    var anchors = findCardAnchors(document);
    var seen = [];
    var report = [];

    for (var i = 0; i < anchors.length; i++) {
      var anchor = anchors[i];
      var card = resolveCard(anchor);
      if (!card) continue;
      if (seen.indexOf(card) !== -1) continue;

      // Rule 5: a price with no "Current price" label of its own AND no
      // "Avg. per night" ancestor is not a room rate. resolveCard already
      // requires the marker, so this only has to reject the case where neither
      // signal is present.
      var hasLabel = rxPriceLabel().test(normText(anchor)) || findPriceLabels(card).length > 0;
      var hasMarker = CONFIG.rateCards.nightlyMarkerRe.test(normText(card));
      if (!hasLabel && !hasMarker) continue;

      var priced = assembleCardPrice(card);
      if (!priced || priced.cents == null) continue;

      seen.push(card);
      report.push({
        room: findRoomName(card) || "(unnamed)",
        price: priced.text,
        cents: priced.cents,
        via: priced.source,
      });
      attachBadge(card, anchor);
    }

    state.lastCardCount = seen.length;
    state.lastCardReport = report;

    // Rule 7: say how many cards matched and what price was assembled for each,
    // so the figures can be checked against the page without opening devtools.
    // Keyed on the content so a settled page does not repeat itself.
    var key = JSON.stringify(report);
    if (key !== lastCardReport) {
      lastCardReport = key;
      if (report.length) {
        console.log("[bliss] " + report.length + " card(s) matched, prices assembled:");
        for (var r = 0; r < report.length; r++) {
          console.log(
            "  " + (r + 1) + ". " + report[r].room +
              "  ->  " + report[r].price +
              "  (" + report[r].cents + " cents, via " + report[r].via + ")"
          );
        }
      } else {
        console.log("[bliss] 0 cards matched.");
      }
    }
  }

  /** Whether a trigger's own nodes are still mounted. */
  function triggerAlive(t) {
    if (!t || !t.hostEl) return false;
    if (t.kind === "details") return !!t.hostEl.isConnected;
    return !!(t.cardEl && t.cardEl.isConnected && t.hostEl.isConnected);
  }

  /**
   * Whether some OTHER live trigger is currently mounted on this card.
   *
   * The children-replaced re-render is the case this exists for: iHotelier
   * keeps the card element and swaps its subtree, which takes our teaser with
   * it. decorateRateCards runs before pruneTriggers, so by the time we get here
   * a fresh trigger has already been built on this same card element and has
   * stamped DECORATED_ATTR with its own id. Clearing the card's attributes on
   * behalf of the dead trigger would strip that stamp off a card that is still
   * decorated, and attachBadge only consults the "is our badge already in
   * there" check INSIDE the hasAttribute branch, so the next sync would sail
   * past the guard and inject a second teaser, then a third, one per sync.
   *
   * Scans the whole array rather than the kept list: the replacement trigger is
   * pushed at the end, so it always sits after the dead one.
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
      // Undo what we did to the host card, but only once nothing of ours is
      // mounted on it. See cardHasLiveTrigger.
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
  // PLACEMENT — checkout step, the "Your Reservation" panel
  // -------------------------------------------------------------------------

  /** How far to climb from the money node looking for its row. */
  var DETAILS_ROW_CLIMB_MAX = 6;

  /**
   * CONTAINMENT. How much wider than the total row a node may be and still be
   * treated as part of the same row rather than as a wrapper around the card.
   *
   * The total row and the card's inner content share a width. A section or page
   * wrapper is materially wider, and inserting after one of those is what put
   * the block on the page background below ADD ANOTHER ROOM. 1.25 leaves room
   * for a row that sits inside a slightly padded parent without admitting a
   * full-width wrapper.
   */
  var DETAILS_ROW_MAX_WIDTH_RATIO = 1.25;

  /**
   * How far chooseDetailsSlot may climb out of table-ish containers. Was 8,
   * which is far enough to leave the card entirely on markup whose widths do
   * not change on the way up.
   */
  var DETAILS_SLOT_CLIMB_MAX = 3;

  /** Measured width, or 0 when unmeasurable. Companion to hasBox. */
  function widthOf(el) {
    if (!el || el.nodeType !== 1) return 0;
    try {
      return el.getBoundingClientRect().width;
    } catch (e) {
      return 0;
    }
  }

  /**
   * The checkout anchor: the node the total is rendered by, plus how it was
   * found.
   *
   * ELEMENT NAME FIRST, text second. The text search is what put the block in a
   * dead subtree: "Total Reservation" appears only inside the collapsed cart
   * panel, so every match measured 0x0 and there was no laid-out candidate for
   * it to prefer. Resolving by element name goes straight to the node the guest
   * can see.
   *
   * The ELEMENT path no longer requires a box, only text that parses to money,
   * preferring a laid-out instance when several parse. The TEXT fallback still
   * requires a box, because it selects by prose and a hidden branch is exactly
   * what it would otherwise latch onto.
   *
   * @returns {{el: Element, source: "element"|"text", boxed?: boolean,
   *           cents?: number}|null}
   */
  var lastAnchorAmbiguityKey = null;

  /**
   * More than one instance parsed, and they disagree. Name the winner and its
   * value so a wrong total is visible in the console rather than silently
   * driving the plan. Deduped on the value set, so a settled page says it once.
   */
  function reportAnchorAmbiguity(candidates, pick) {
    var distinct = [];
    for (var i = 0; i < candidates.length; i++) {
      if (distinct.indexOf(candidates[i].cents) === -1) distinct.push(candidates[i].cents);
    }
    if (distinct.length < 2) return;
    var key = distinct.join(",") + "->" + pick.cents;
    if (key === lastAnchorAmbiguityKey) return;
    lastAnchorAmbiguityKey = key;

    var listed = [];
    for (var j = 0; j < candidates.length; j++) {
      listed.push(
        money(candidates[j].cents, CONFIG.currencyFallback) +
          (candidates[j].boxed ? " (laid out)" : " (no box)")
      );
    }
    console.warn(
      "[bliss] " + CONFIG.detailsStep.totalElementSelector +
        " resolved to more than one amount: " + listed.join(", ") + ".\n" +
        "  CHOSE " + money(pick.cents, CONFIG.currencyFallback) +
        (pick.boxed ? " (laid out, preferred)" : " (no box, no laid-out candidate available)") +
        ". If that is the wrong figure, narrow CONFIG.detailsStep.totalElementSelector."
    );
  }

  function resolveDetailsAnchor() {
    var cfg = CONFIG.detailsStep;
    if (!cfg) return null;

    // 1. The total element, selected by whether its text PARSES to money, not
    //    by whether it has a box.
    //
    //    THE BOX REQUIREMENT IS GONE, deliberately. It existed because this
    //    same node used to decide placement, where picking a hidden duplicate
    //    would mount the block into a dead subtree. Placement now comes from
    //    placementTargets and this node is only an amount source, and an
    //    element's text is readable whether or not it is laid out.
    //
    //    It was also the whole of the wide-viewport bug: above the breakpoint
    //    iHotelier renders <ibe-ct-small-rate> with no box, so hasBox rejected
    //    the only instance on the page, the anchor resolved to null and the
    //    mount bailed. 1 in DOM / 0 boxed at w=1419, 1 in DOM / 1 boxed at 864.
    //
    //    A laid-out instance still wins whenever more than one parses, so the
    //    hidden-duplicate case is decided exactly as it was before.
    if (cfg.totalElementSelector) {
      var hits = [];
      var raw = deepQueryAll(document, cfg.totalElementSelector);
      for (var i = 0; i < raw.length; i++) {
        if (!isOurNode(raw[i])) hits.push(raw[i]);
      }

      var candidates = [];
      for (var k = 0; k < hits.length; k++) {
        var cents = parseMoneyTextToCents(normText(hits[k]));
        // Zero or unparsable is not an amount to plan against, so the instance
        // is not a candidate at all rather than a candidate with a bad value.
        if (cents == null || !isFinite(cents) || cents <= 0) continue;
        candidates.push({ el: hits[k], cents: cents, boxed: hasBox(hits[k]) });
      }

      if (candidates.length) {
        var pick = null;
        for (var c = 0; c < candidates.length; c++) {
          if (candidates[c].boxed) {
            pick = candidates[c];
            break;
          }
        }
        if (!pick) pick = candidates[0];
        reportAnchorAmbiguity(candidates, pick);
        // cents rides along, so scrapeDetailsTotalCents reports the figure from
        // the instance actually chosen rather than re-deriving it and possibly
        // disagreeing with what was reported here.
        return { el: pick.el, source: "element", boxed: pick.boxed, cents: pick.cents };
      }
      // PRESENCE IS AUTHORITATIVE, not just a laid-out box.
      //
      // This early return is the fix for the double resolution. hasBox is a
      // point-in-time measurement, and sync runs on every mutation, so during
      // any sync where the payments card has not laid out yet the loop above
      // found nothing and execution fell through to the text search. That
      // search matches "Total Reservation" in the summary and assembles the
      // PRE-TAX SUBTOTAL, which was then logged and used as the plan basis for
      // that sync. A later sync, once laid out, resolved through the element
      // and logged the tax-inclusive total instead. Two totals, two log lines,
      // one of them wrong.
      //
      // If the element is on the page at all, it is the only acceptable source.
      // Returning null here means this sync simply has no anchor; the next one
      // resolves it properly once layout settles.
      if (hits.length) return null;
    }

    // 2. Text fallback, reached ONLY when the element is absent from the DOM
    //    entirely, which means it was renamed. Same descent as before, with the
    //    box test added: skipping unlaid-out matches outright means `best`
    //    starts from the first VISIBLE match, so the walk can no longer descend
    //    into a hidden branch and get stuck there.
    if (!cfg.anchorRe) return null;
    var all = deepQueryAll(document, "*");
    var best = null;
    for (var j = 0; j < all.length; j++) {
      var el = all[j];
      if (isOurNode(el)) continue;
      if (!cfg.anchorRe.test(normText(el))) continue;
      if (!hasBox(el)) continue;
      if (best == null || deepContains(best, el)) best = el;
    }
    return best ? { el: best, source: "text" } : null;
  }

  /** The anchor element alone. Kept as its own name for the existing callers. */
  function findDetailsLabel() {
    var found = resolveDetailsAnchor();
    return found ? found.el : null;
  }

  /**
   * The total ROW: the nearest ancestor of the anchor that has a box of its
   * own. The block is inserted after this, not after the anchor.
   *
   * The distinction matters because the row splits into a label and a figure.
   * Inserting directly after the money node would drop the Bliss block between
   * "Total" and "$ 924.91", splitting the host's own row in half.
   *
   * NO AMOUNT TEST. The old version required the ancestor's text to hold both
   * the anchor phrase and a currency figure, which was how it identified a row
   * when the anchor was only a label. The anchor is now the money node itself,
   * so that test has nothing left to establish, and on a row whose text reads
   * just "Total" it would reject the correct answer.
   */
  function findDetailsRow() {
    var found = resolveDetailsAnchor();
    if (!found) return null;
    var node = parentAcrossShadow(found.el);
    for (var d = 0; d < DETAILS_ROW_CLIMB_MAX && node && node.nodeType === 1; d++) {
      if (isOurNode(node)) break;
      // FIRST laid-out ancestor wins, and the climb stops dead here. Everything
      // above this node is a wrapper by definition, so there is nothing further
      // up worth considering; the width ceiling this establishes is what
      // chooseDetailsSlot is then held to.
      if (hasBox(node)) return node;
      node = parentAcrossShadow(node);
    }
    // Nothing above it measured. NULL, not the anchor: the anchor is no longer
    // required to have a box, so returning it here would hand chooseDetailsSlot
    // an unlaid-out node to insert beside. A null row is no longer fatal, it
    // just means the amount-row fallback is unavailable and placement has to
    // come from placementTargets.
    return null;
  }

  /**
   * Displays whose CHILDREN cannot be an arbitrary block-level element.
   *
   * A <div> dropped between two <tr>s, or beside a <td> inside a <tr>, is not
   * table content. The browser either wraps it in an anonymous cell or gives it
   * no box at all, and either way it commonly measures 0 by 0. That is the
   * classic way a node can be "inserted, rendered, and invisible" at the same
   * time, which is exactly the reported symptom.
   */
  var NO_BLOCK_CHILDREN = {
    table: 1,
    "table-row": 1,
    "table-row-group": 1,
    "table-header-group": 1,
    "table-footer-group": 1,
    "table-cell": 1,
    "table-column": 1,
    "table-column-group": 1,
    "table-caption": 1,
    "inline-table": 1,
    "ruby": 1,
    "ruby-text": 1,
  };

  function displayOf(el) {
    try {
      return String(ownerWin(el).getComputedStyle(el).display || "");
    } catch (e) {
      return "";
    }
  }

  /**
   * WHERE THE BLOCK GOES, which is not the same question as where the amount
   * comes from. The amount anchor stays put and keeps feeding the figure; only
   * the placement target moves.
   *
   * Walks CONFIG.detailsStep.placementTargets in order and takes the first
   * LAID-OUT hit, so the preferred position wins whenever the page offers it
   * and each later entry is a genuine fallback rather than a competitor. A
   * "before" target additionally needs a parent to be inserted relative to.
   *
   * Falls through to the amount anchor's own row via chooseDetailsSlot when no
   * entry resolves, so a page shape we have not captured still gets a block.
   *
   * @returns {{el: Element, mode: "before"|"first-child"|"inside"|"after"}}
   */
  /** First laid-out, non-ours match for a selector, or null. */
  function firstLaidOutMatch(selector) {
    if (!selector) return null;
    var hits = deepQueryAll(document, selector);
    for (var i = 0; i < hits.length; i++) {
      if (isOurNode(hits[i])) continue;
      if (hasBox(hits[i])) return hits[i];
    }
    return null;
  }

  /** Deepest laid-out, non-ours element whose deep text matches, or null. */
  function deepestLaidOutTextMatch(re) {
    var all = deepQueryAll(document, "*");
    var best = null;
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (isOurNode(el)) continue;
      if (!re.test(normText(el))) continue;
      if (!hasBox(el)) continue;
      if (best == null || deepContains(best, el)) best = el;
    }
    return best;
  }

  /** Does this element paint a border on any edge? Marks a panel container. */
  function hasBorder(el) {
    try {
      var cs = ownerWin(el).getComputedStyle(el);
      if (!cs.borderTopStyle || cs.borderTopStyle === "none") {
        if (!cs.borderBottomStyle || cs.borderBottomStyle === "none") return false;
      }
      return (parseFloat(cs.borderTopWidth) || 0) > 0 || (parseFloat(cs.borderBottomWidth) || 0) > 0;
    } catch (e) {
      return false;
    }
  }

  /**
   * A panel identified by its heading text: climb from the heading to the box
   * that IS the panel.
   *
   * The stop condition is what makes this precise. `stopBeforeSelector` names
   * something that comes AFTER the panel (the card fields), and the climb halts
   * the moment an ancestor would swallow it. The answer is therefore the
   * outermost box containing the heading and not the thing after it, which is
   * the panel, without needing to recognise the panel by its styling.
   *
   * Falls back to the first bordered ancestor when that marker cannot be
   * resolved, since a bordered box is the next best signal for "panel".
   */
  function resolveTextPanel(spec) {
    var mark = deepestLaidOutTextMatch(spec.textRe);
    if (!mark) return null;
    var avoid = firstLaidOutMatch(spec.stopBeforeSelector);
    var node = mark;
    var best = null;
    for (var d = 0; d < (spec.climbMax || 8) && node && node.nodeType === 1; d++) {
      if (isOurNode(node)) break;
      if (avoid && node !== mark && deepContains(node, avoid)) break;
      if (hasBox(node) && node.parentNode) {
        best = node;
        // With no stop marker, a border is the only signal that we have reached
        // the panel rather than some wrapper inside it.
        if (!avoid && node !== mark && hasBorder(node)) break;
      }
      node = parentAcrossShadow(node);
    }
    return best;
  }

  function findDetailsPlacement(row) {
    var cfg = CONFIG.detailsStep;
    var targets = (cfg && cfg.placementTargets) || [];
    for (var t = 0; t < targets.length; t++) {
      var spec = targets[t];
      if (!spec) continue;
      var mode = spec.mode || "before";
      var el = spec.textRe ? resolveTextPanel(spec) : firstLaidOutMatch(spec.selector);
      if (!el) continue;
      // A sibling insertion needs somewhere to be a sibling IN. Without this
      // the mode would be honoured and the insert would throw on a detached
      // or root-level match.
      if ((mode === "before" || mode === "after") && !el.parentNode) continue;
      return { el: el, mode: mode };
    }
    // The amount-row fallback is the ONLY thing that needs a row, and the row
    // is now allowed to be null. Returning null here rather than handing
    // chooseDetailsSlot a null is what lets ensureDetailsTrigger treat "no
    // placement anywhere" as the bail condition instead of "no row".
    if (!row) return null;
    return chooseDetailsSlot(row);
  }

  /**
   * The node the block should be inserted AFTER, when no placement target
   * resolved and we are falling back to the amount anchor's own row.
   *
   * Starts at that row and climbs while the would-be parent is something that
   * cannot lay out a block child. Inserting into a table row or a cell is the
   * failure this avoids: the block ends up sized by a container the page fits
   * to its own content, which is the "nested cell" case.
   *
   * Climbing stops as soon as a normal flow parent is found, so on markup that
   * is already plain divs this returns the row itself.
   */
  function chooseDetailsSlot(row) {
    // A CELL CAN HOLD A BLOCK, so go inside it rather than climbing out of the
    // table. A table and its own rows share a width, so the width ceiling below
    // cannot stop that climb, and walking out returns the <table> itself, which
    // puts the block below every row in it including ADD ANOTHER ROOM. That is
    // the one escalation that is guaranteed to leave the card.
    if (displayOf(row) === "table-cell") return { el: row, mode: "inside" };

    // CONTAINMENT CEILING, from the row findDetailsRow settled on. Anything
    // materially wider than the total row is a section or page wrapper, not a
    // container we belong in, and inserting after one of those is what put the
    // block on the page background. The hop cap is the backstop for a chain
    // that stays the same width all the way up.
    var maxWidth = widthOf(row) * DETAILS_ROW_MAX_WIDTH_RATIO;
    var node = row;
    for (var d = 0; d < DETAILS_SLOT_CLIMB_MAX; d++) {
      var parent = parentAcrossShadow(node);
      if (!parent || parent.nodeType !== 1) break;
      var pd = displayOf(parent);
      if (!NO_BLOCK_CHILDREN[pd]) break;
      if (maxWidth > 0 && widthOf(parent) > maxWidth) break;
      node = parent;
    }
    return { el: node, mode: "after" };
  }

  /**
   * Is the total element on the page at all, laid out or not?
   *
   * Separates "we are not on the checkout step" from "we are, but the payment
   * section is mid-render". They look identical to resolveDetailsAnchor, which
   * returns null for both, and they need opposite responses: drop the block for
   * the first, come back and look again for the second.
   */
  function detailsAnchorPresent() {
    var cfg = CONFIG.detailsStep;
    if (!cfg || !cfg.totalElementSelector) return false;
    var hits = deepQueryAll(document, cfg.totalElementSelector);
    for (var i = 0; i < hits.length; i++) {
      if (!isOurNode(hits[i])) return true;
    }
    return false;
  }

  // BOUNDED RE-CHECK, not a poll. Armed only when the anchor element is on the
  // page but did not resolve, which means a re-render is in flight. It fires at
  // most DETAILS_MAX_RECHECKS times, ~250ms apart, and the counter resets the
  // moment a block mounts or the checkout step is genuinely gone. On a settled
  // page nothing is ever scheduled.
  //
  // This exists because the mutation-driven sync can land on a half-updated
  // DOM: the re-render's mutations are coalesced into one sync, and if that
  // sync cannot resolve, nothing re-runs. Resize covers the DevTools case; this
  // covers a payment-section re-render that arrives without one.
  var DETAILS_RECHECK_MS = 250;
  var DETAILS_MAX_RECHECKS = 3;
  var detailsRecheckTimer = null;
  var detailsRechecks = 0;

  function scheduleDetailsRecheck() {
    if (detailsRecheckTimer != null) return;
    if (detailsRechecks >= DETAILS_MAX_RECHECKS) return;
    detailsRechecks++;
    detailsRecheckTimer = window.setTimeout(function () {
      detailsRecheckTimer = null;
      try {
        sync();
      } catch (e) {
        console.warn("[bliss] checkout re-check failed", e);
      }
    }, DETAILS_RECHECK_MS);
  }

  function cancelDetailsRecheck() {
    if (detailsRecheckTimer != null) {
      window.clearTimeout(detailsRecheckTimer);
      detailsRecheckTimer = null;
    }
    detailsRechecks = 0;
  }

  /**
   * Set when the block was removed for a REAL reason: the total read fine and
   * the merchant's rules rejected it, or no cadence fits. Distinguishes that
   * from "mid-render, try again", and is what stops the watchdog below from
   * mounting and removing the block twice a second on an ineligible stay.
   * Cleared whenever a block successfully mounts.
   */
  var detailsSettledEmpty = false;

  /** Is a details block currently mounted and attached to the document? */
  function detailsHostAlive() {
    for (var i = 0; i < state.triggers.length; i++) {
      var t = state.triggers[i];
      if (t.kind === "details") return !!(t.hostEl && t.hostEl.isConnected);
    }
    return false;
  }

  /**
   * HOST WATCHDOG, and yes, this is a polling interval. Adding one was the
   * explicit last resort and this is the second attempt at recovering by
   * events alone, so it is now the safety net under the event paths rather
   * than the mechanism.
   *
   * Every 500ms it asks one question: should there be a block, and is there
   * one? If a block is mounted it stops at the first check, which is a walk of
   * state.triggers and nothing else, so the settled-page cost is negligible.
   * The expensive check, whether the anchor element exists anywhere in the
   * tree, only runs when no block is mounted.
   *
   * It deliberately does NOT fire when detailsSettledEmpty is set, so an
   * ineligible stay is left alone instead of being remounted on a loop.
   */
  var HOST_WATCHDOG_MS = 500;
  var watchdogTimer = null;

  function startHostWatchdog() {
    if (watchdogTimer != null) return;
    if (typeof window.setInterval !== "function") return;
    watchdogTimer = window.setInterval(function () {
      if (detailsHostAlive()) return;
      if (detailsSettledEmpty) return;
      if (!detailsAnchorPresent()) return;
      try {
        sync();
      } catch (e) {
        console.warn("[bliss] watchdog sync failed", e);
      }
    }, HOST_WATCHDOG_MS);
  }

  function stopHostWatchdog() {
    if (watchdogTimer != null) {
      window.clearInterval(watchdogTimer);
      watchdogTimer = null;
    }
  }

  // =========================================================================
  // PLACEMENT PROBE — TEMPORARY DIAGNOSTIC, delete once the breakpoint failure
  // is understood.
  //
  // The block mounts at 864 and never at 1419, and the trigger count sits at
  // zero at the wider width, so something in the resolution chain returns null
  // above a breakpoint. This prints the whole chain on one line so the failing
  // link is visible without stepping through it.
  //
  // READ-ONLY. Every resolver it calls is a pure read (resolveDetailsAnchor,
  // findDetailsRow, resolveTextPanel, firstLaidOutMatch), so re-running them
  // here cannot change what the real path decided. It costs a second pass over
  // the tree per sync, which is why it is temporary.
  //
  // Deduped on content by default, because sync runs on every mutation and the
  // watchdog adds one every 500ms while the block is missing. That means one
  // line per distinct state, which is exactly what makes a resize readable.
  // Set CONFIG.detailsStep.logPlacementEverySync = true to print every time.
  // =========================================================================
  var detailsBail = null;
  var lastProbeLine = null;

  function probeEl(el) {
    if (!el) return "NULL";
    var r = null;
    try {
      r = el.getBoundingClientRect();
    } catch (e) {
      r = null;
    }
    var cls = (el.className && typeof el.className === "string" ? el.className : "").split(/\s+/)[0];
    return (
      "<" + (el.tagName || "?").toLowerCase() + (cls ? "." + cls : "") + " " +
      (r ? Math.round(r.width) + "x" + Math.round(r.height) : "?") + ">"
    );
  }

  function probeSpecLabel(spec) {
    if (!spec) return "?";
    if (spec.textRe) return "text " + String(spec.textRe);
    return String(spec.selector || "?");
  }

  function probeDetails() {
    var cfg = CONFIG.detailsStep;
    if (!cfg) return;
    var bits = [];

    bits.push("w=" + (window.innerWidth || 0));

    // 1. Anchor: present in DOM at all, versus present but unlaid-out.
    var inDom = 0;
    var boxed = 0;
    if (cfg.totalElementSelector) {
      var hits = deepQueryAll(document, cfg.totalElementSelector);
      for (var i = 0; i < hits.length; i++) {
        if (isOurNode(hits[i])) continue;
        inDom++;
        if (hasBox(hits[i])) boxed++;
      }
    }
    var anchor = resolveDetailsAnchor();
    bits.push(
      "anchor " + cfg.totalElementSelector + ": " + inDom + " in DOM / " + boxed + " boxed -> " +
      (anchor ? anchor.source + " " + probeEl(anchor.el) : "NULL")
    );

    // 2. Every placement target, in order, resolved or not.
    var targets = cfg.placementTargets || [];
    var tb = [];
    for (var t = 0; t < targets.length; t++) {
      var spec = targets[t];
      var el = null;
      try {
        el = spec ? (spec.textRe ? resolveTextPanel(spec) : firstLaidOutMatch(spec.selector)) : null;
      } catch (e) {
        el = null;
      }
      tb.push("[" + t + "] " + probeSpecLabel(spec) + " -> " + probeEl(el));
    }
    bits.push("targets " + (tb.join("  ") || "(none configured)"));

    // 3. Row climb.
    var rowEl = null;
    try {
      rowEl = findDetailsRow();
    } catch (e) {
      rowEl = null;
    }
    bits.push("row -> " + probeEl(rowEl));

    // 4. What ensureDetailsTrigger did, and what survived to the end of sync.
    var live = 0;
    var connected = 0;
    for (var k = 0; k < state.triggers.length; k++) {
      if (state.triggers[k].kind !== "details") continue;
      live++;
      if (state.triggers[k].hostEl && state.triggers[k].hostEl.isConnected) connected++;
    }
    bits.push("ensure: " + (detailsBail || "not reached"));
    bits.push("triggers " + live + " (connected " + connected + ")");

    var line = "[bliss probe] " + bits.join("  |  ");
    if (!cfg.logPlacementEverySync && line === lastProbeLine) return;
    lastProbeLine = line;
    console.log(line);
  }

  function ensureDetailsTrigger() {
    var cfg = CONFIG.detailsStep;
    detailsBail = "reached-config-gate"; // TEMP PROBE, see probeDetails
    // Either anchor source is enough. Gating on anchorRe alone would kill the
    // whole checkout path if the text fallback were ever dropped, even though
    // it is now the secondary of the two.
    if (!cfg || (!cfg.totalElementSelector && !cfg.anchorRe)) {
      detailsBail = "BAILED at config gate (no totalElementSelector and no anchorRe)";
      return;
    }

    var label = findDetailsLabel();
    var row = label ? findDetailsRow() : null;

    var existing = null;
    for (var i = 0; i < state.triggers.length; i++) {
      if (state.triggers[i].kind === "details") existing = state.triggers[i];
    }

    // PLACEMENT IS THE GATE, not the row.
    //
    // The row used to be a hard bail here, which was wrong once placement moved
    // to placementTargets: the row is only needed for the amount-row fallback
    // INSIDE findDetailsPlacement, and it climbs from an anchor that is no
    // longer required to be laid out. A null row now simply means that one
    // fallback is unavailable.
    var placement = findDetailsPlacement(row);

    if (!placement) {
      // Two very different situations arrive here identically. If the anchor
      // element is on the page, this is a re-render in flight and the block
      // should come back on its own; if it is not, we have genuinely left the
      // checkout step and there is nothing to wait for.
      detailsBail =
        "BAILED at placement gate (no placementTarget resolved and " +
        (row ? "the amount-row fallback produced nothing" : "no row to fall back to") +
        "; anchor " + (label ? "resolved" : "did not resolve") +
        ", element " + (detailsAnchorPresent() ? "present in DOM" : "absent from DOM") +
        ")";
      if (detailsAnchorPresent()) scheduleDetailsRecheck();
      else cancelDetailsRecheck();

      // Drop any block left from a previous visit either way: its host has
      // already gone with the re-render, and a fresh one is mounted below once
      // resolution succeeds.
      if (existing) {
        if (existing.hostEl && existing.hostEl.parentNode) {
          existing.hostEl.parentNode.removeChild(existing.hostEl);
        }
        state.triggers = state.triggers.filter(function (x) {
          return x !== existing;
        });
      }
      return;
    }

    // DOUBLE-INJECTION GUARD, matching the rate cards'.
    //
    // Our tracked block is still mounted in the same place against the same
    // row, so there is nothing to do. rowEl and slotEl are both part of the
    // test, not just isConnected: a block still attached to a node the page has
    // since replaced is stale, and returning early on it would strand it there.
    if (
      existing &&
      existing.hostEl.isConnected &&
      existing.rowEl === row &&
      existing.slotEl === placement.el
    ) {
      // Still mounted where it belongs, so nothing is in flight.
      detailsBail = "OK already mounted (guard hit)";
      cancelDetailsRecheck();
      return;
    }

    // About to mount. Remove EVERY details host on the page first, tracked or
    // not, so re-running the overlay REPLACES the block rather than adding a
    // second one beside it.
    //
    // The previous sweep deliberately spared the tracked host and then returned
    // early on it, which meant a second run whose own state had no trigger yet
    // could not see the first run's block as something to replace. Pasting
    // twice therefore left two hosts in the panel. Sweeping unconditionally at
    // the one point where a new host is about to be created makes the count
    // exactly one by construction, whoever mounted the previous one.
    var strays = deepQueryAll(document, "[data-bliss-details]");
    for (var s = 0; s < strays.length; s++) {
      if (strays[s].parentNode) strays[s].parentNode.removeChild(strays[s]);
    }
    deepQueryAll(document, "[" + DECORATED_ATTR + "]").forEach(function (el) {
      // Only the checkout row carries both marks; rate cards keep theirs.
      if (el.hasAttribute("data-bliss-details-row")) {
        el.removeAttribute(DECORATED_ATTR);
        el.removeAttribute("data-bliss-details-row");
      }
    });

    // Carry an open modal across the replacement, otherwise renderModal looks up
    // a trigger id that no longer exists and silently closes itself.
    var modalWasOnExisting = !!(existing && state.modal && state.modal.triggerId === existing.id);
    state.triggers = state.triggers.filter(function (x) {
      return x !== existing;
    });

    // Created in the PLACEMENT target's document, not the row's: the row is now
    // allowed to be null, and the placement target is the tree the host
    // actually joins.
    var hostEl = (placement.el.ownerDocument || document).createElement("div");
    hostEl.setAttribute(BADGE_ATTR, "");
    hostEl.setAttribute("data-bliss-details", "");
    hostEl.style.display = "none";
    hostEl.style.width = "100%";
    hostEl.style.boxSizing = "border-box";
    hostEl.style.marginTop = (cfg.marginTopPx == null ? 10 : cfg.marginTopPx) + "px";
    // flex-grow 1, flex-shrink 0, basis 100%. The basis alone was not enough:
    // in a nowrap flex row the default flex-shrink of 1 lets the box be
    // squeezed toward zero by its siblings, which renders as a mounted block
    // with no width. Shrink 0 keeps it at full width and forces its own line.
    hostEl.style.flex = "1 0 100%";
    hostEl.style.flexBasis = "100%";
    hostEl.style.gridColumn = "1 / -1";
    var root = hostEl.attachShadow({ mode: "open" });
    // Inserted into the SLOT's own tree, which is the panel's shadow root, by
    // the same sibling insertion the rate cards use. Mounting in the top
    // document would leave it rendering somewhere else entirely.
    //
    // The slot is the row itself on plain markup, and the nearest ancestor that
    // a block can legally sit beside when the row is a table row or a cell.
    var slot = placement.el;
    if (placement.mode === "before") {
      // Sibling immediately BEFORE the card fields container, inside
      // div.payment-details, which puts the block between the Travel
      // Protection panel above and the card brand logos below.
      slot.parentNode.insertBefore(hostEl, slot);
    } else if (placement.mode === "first-child") {
      // FIRST child of the consent wrapper, so the block sits below the card
      // fields and above the checkbox list. insertBefore with firstChild is
      // correct even when that first child is a text node, and is a no-op-safe
      // append when the wrapper is empty.
      slot.insertBefore(hostEl, slot.firstChild);
    } else if (placement.mode === "inside") {
      // Last child of the cell, so the block sits under the cell's own content
      // and inside the card, rather than after the table and below every row.
      slot.appendChild(hostEl);
    } else {
      slot.parentNode.insertBefore(hostEl, slot.nextSibling);
    }
    // Marked the way a decorated rate card is, so a stray host is traceable to
    // its row and the sweep above can clear the mark it owns.
    // Guarded: the row is optional now, and these marks only exist so a stray
    // host is traceable back to it. No row simply means no mark to leave.
    if (row && row.setAttribute) {
      row.setAttribute(DECORATED_ATTR, "details");
      row.setAttribute("data-bliss-details-row", "");
    }
    // TYPOGRAPHY SOURCE, now the FAMILY ONLY. renderTrigger reads it off this
    // node, and it tracks where the block actually sits rather than where the
    // amount came from: the consent wrapper, whose text is the checkbox rows.
    //
    // Sampling the row gave 16px weight 600, which is the total's display
    // scale and far too heavy in this position. Size and weight are no longer
    // sampled at all; triggerCss sets them explicitly under .details, so the
    // result does not depend on whichever node happened to be the anchor.
    var anchor = slot;

    // Mounted. Clear any pending re-check and reset the budget, so the next
    // re-render gets a full allowance rather than the remainder of this one's,
    // and clear the settled-empty latch so the watchdog is armed again.
    cancelDetailsRecheck();
    detailsSettledEmpty = false;
    detailsBail = "OK mounted (mode " + placement.mode + ")";

    var newId = state.nextId++;
    if (modalWasOnExisting && state.modal) state.modal.triggerId = newId;
    state.triggers.push({
      id: newId,
      kind: "details",
      cardEl: null,
      rowEl: row,
      slotEl: slot,
      anchorEl: anchor,
      hostEl: hostEl,
      root: root,
      label: null,
      amountCents: null,
      nightlyAmountCents: null,
      scrapedNightlyCents: null,
      currency: null,
      rateId: null,
      rateName: null,
      amountSource: null,
      preview: null,
      confirmed: null,
    });
  }

  // -------------------------------------------------------------------------
  // SYNC
  // -------------------------------------------------------------------------

  var warnedTotalUnparsed = false;
  var lastLoggedTotal = null;

  /**
   * The TAX-INCLUSIVE "Total Reservation" figure, in integer cents.
   *
   * Read by the same label-then-forward-scan the rate cards use, because the
   * checkout panel fragments its amounts the same way: the currency symbol and
   * the digits are separate nodes, so a regex on the row's own element would
   * find nothing.
   *
   * Deliberately the TOTAL and not "Reservation Subtotal". The subtotal is
   * pre-tax, and a plan written against it would under-quote every installment
   * against what the guest is actually charged.
   */
  function scrapeDetailsTotalCents() {
    var cfg = CONFIG.detailsStep;
    if (!cfg) return null;
    var found = resolveDetailsAnchor();
    if (!found) return null;
    var label = found.el;

    var cents;
    if (found.source === "element") {
      // The anchor IS the money node, so read its own text: "$ 924.91". No
      // global lookup and no forward scan across siblings, which is what the
      // label-shaped anchor needed and what could drift onto a different
      // figure. normText goes through deepText, so a total rendered inside the
      // element's own shadow root still reads.
      // resolveDetailsAnchor already parsed this instance to choose it, so take
      // its figure rather than re-deriving one that could disagree with the
      // ambiguity warning it just printed.
      cents = found.cents != null ? found.cents : parseMoneyTextToCents(normText(label));
    } else {
      // Text fallback: the anchor is a label, so the figure still has to be
      // assembled from what follows it.
      var got = assembleAmountAfterLabel(label, cfg.anchorRe);
      cents = got ? got.cents : null;
    }

    // An anchor that resolves but yields no number would hide the whole block
    // with no clue why, which is exactly how the old selector version failed
    // silently. Say it out loud instead, and name WHICH anchor was used, since
    // the two paths fail for different reasons and take different fixes.
    if (cents == null && !warnedTotalUnparsed) {
      warnedTotalUnparsed = true;
      console.warn(
        "[bliss] resolved the checkout total anchor (" +
          (found.source === "element"
            ? "<" + (label.tagName || "?").toLowerCase() + ">, via CONFIG.detailsStep.totalElementSelector"
            : "text match, via CONFIG.detailsStep.anchorRe") +
          ") but could not read an amount from it.\n" +
          "  anchor text: " + JSON.stringify(normText(label).slice(0, 80)) + "\n" +
          "  row text: " + JSON.stringify(normText(findDetailsRow() || label).slice(0, 80))
      );
    }
    if (cents != null && cents !== lastLoggedTotal) {
      lastLoggedTotal = cents;
      console.log(
        "[bliss] checkout block: total " + money(cents, CONFIG.currencyFallback) +
          " (tax-inclusive basis, plan written against this plus the Bliss fee)" +
          "  |  anchor: " +
          (found.source === "element"
            ? "<" + (label.tagName || "?").toLowerCase() + ">"
            : "text fallback")
      );
    }
    return cents;
  }

  function applyAmount(t) {
    if (t.kind === "details") {
      t.detailsTotalCents = scrapeDetailsTotalCents();
      // The modal is written against the tax-inclusive total plus the Bliss fee
      // — the same basis the block's own teaser uses, so the two agree by
      // construction.
      t.amountCents = t.detailsTotalCents == null ? null : Math.round(t.detailsTotalCents * (1 + BLISS_FEE_RATE));
      t.nightlyAmountCents = null;
      t.scrapedNightlyCents = null;
      t.currency = null;
      t.rateId = null;
      t.rateName = null;
      t.amountSource = t.amountCents == null ? null : "details-total";
      return;
    }
    var resolved = resolveCardAmount(t.cardEl, state.dl);
    // Independent of `resolved`: the trigger's per-night figure comes from the
    // card's displayed price.
    t.scrapedNightlyCents = scrapeNightlyCents(t.cardEl);
    // The modal is written against the PRE-TAX stay total: the card's own
    // displayed nightly price times nights, matching the basis the teaser quotes.
    var preTaxStay = toStayTotalCents(t.scrapedNightlyCents, state.dl);
    t.amountCents = preTaxStay != null ? preTaxStay : resolved ? resolved.amountCents : null;
    t.nightlyAmountCents = resolved ? resolved.nightlyAmountCents : null;
    t.currency = resolved ? resolved.currency : null;
    t.rateId = resolved ? resolved.rateId : null;
    t.rateName = resolved ? resolved.rateName : null;
    t.amountSource = resolved ? resolved.source : null;
  }

  function recompute() {
    state.triggers.forEach(function (t) {
      applyAmount(t);
      t.preview = computeFor(t.amountCents);
      if (t.kind === "rate-card") t.label = t.rateName || findRoomName(t.cardEl) || t.label;
      if (t.kind === "details") {
        // State A/B is driven by the session-level choice, not by this trigger's
        // own confirmation — the rate-card trigger that recorded it no longer
        // exists. Mirrored onto `confirmed` so the modal's existing "Plan
        // selected" cancel row renders unchanged.
        t.confirmed = state.planChoice;
        if (t.confirmed && !optionByFrequency(t.preview, t.confirmed.frequency)) t.confirmed = null;
        return;
      }
      // Restore after an iHotelier re-render. The trigger that recorded the
      // plan was destroyed along with the card and decorateRateCards built a
      // fresh one in its place with confirmed:null, so the session-level
      // planChoice is the only surviving copy. Keyed on content, so it lands on
      // the ONE card the guest actually chose and every other card stays
      // unconfirmed. Both keys must be non-null: a card with no resolvable
      // title, and a plan confirmed from the details step, both key to null and
      // must not match each other.
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
        // Repair only a selection that has become INVALID. A null selection is
        // deliberate (the guest deselected) and must survive: repairing it would
        // silently re-select the plan they had just cancelled.
        state.modal.selected = defaultSelected(mt.preview);
      }
    }
  }

  function ensureTheme() {
    if (state.theme) return;
    state.theme = sampleHostTheme(window);
  }

  function sync() {
    ensureTheme();
    var prev = state.dl;
    state.dl = readStay();

    // A date change invalidates every figure on the page, so say so once and
    // let the unconditional recompute below do the work. Nothing is guarded on
    // this flag: recompute() and renderAllTriggers() run every sync anyway, so
    // the new nights count reaches every teaser and any open modal by the same
    // path a card re-render already used.
    if (prev && rangeChanged(prev, state.dl)) {
      console.log(
        "[bliss] stay changed: " + prev.checkinIso + " to " + prev.checkoutIso +
          " (" + prev.nights + " nights)  ->  " + state.dl.checkinIso + " to " + state.dl.checkoutIso +
          " (" + state.dl.nights + " nights). Recomputing every teaser" +
          (state.modal ? " and the open modal." : ".")
      );
    }

    ensureDetailsTrigger();
    decorateRateCards();
    pruneTriggers();
    recompute();
    renderAllTriggers();
    ensureObserver();
    if (state.modal) renderModal();
    // TEMPORARY. Runs last so it reports what SURVIVED the sync, not just what
    // ensureDetailsTrigger mounted: renderAllTriggers can still remove the
    // block on the suppression path after it was mounted this same pass.
    try {
      probeDetails();
    } catch (e) {
      /* a diagnostic must never break the sync it is diagnosing */
    }
  }

  function rangeChanged(a, b) {
    if (!a || !b) return false;
    return a.checkinIso !== b.checkinIso || a.checkoutIso !== b.checkoutIso || a.nights !== b.nights;
  }

  function refresh() {
    state.theme = null; // force a re-sample
    sync();
  }

  // ---- re-attach after SPA re-renders -------------------------------------
  // iHotelier re-renders the room list on filter and date changes, which takes
  // our teasers with it. Re-running sync is cheap because attachBadge is guarded
  // by DECORATED_ATTR, so a settled page does no work per mutation.
  //
  // The same observer covers date changes: sync() re-reads the URL every time,
  // so a re-render caused by a new stay picks up the new dates in the same pass.
  // popstate and hashchange are bound as well for a URL change that somehow
  // mutates nothing.
  var moPending = false;
  var observer = null;
  var navBound = false;
  // One observer per shadow root, as {root, obs}. A MutationObserver on
  // document.body does NOT see mutations inside a shadow root: a shadow tree is
  // a separate tree and needs its own observer, so without these the teasers
  // would never come back after Amadeus re-renders a card.
  var shadowObservers = [];

  function onMutation() {
    if (moPending) return;
    moPending = true;
    schedule(function () {
      moPending = false;
      try {
        sync();
      } catch (e) {
        console.warn("[bliss] sync failed", e);
      }
    });
  }

  function observeShadowRoots() {
    if (typeof window.MutationObserver !== "function") return;
    var roots = deepShadowRoots(document);
    var i, j;

    for (i = 0; i < roots.length; i++) {
      var already = false;
      for (j = 0; j < shadowObservers.length; j++) {
        if (shadowObservers[j].root === roots[i]) already = true;
      }
      if (already) continue;
      // Skip our OWN teaser roots. Observing them would turn every render into
      // a mutation that schedules another sync, which renders again.
      if (roots[i].host && roots[i].host.hasAttribute && roots[i].host.hasAttribute(BADGE_ATTR)) continue;
      if (roots[i] === modalRoot) continue;
      try {
        var obs = new window.MutationObserver(onMutation);
        obs.observe(roots[i], { childList: true, subtree: true, characterData: true });
        shadowObservers.push({ root: roots[i], obs: obs });
      } catch (e) {
        /* ignore */
      }
    }

    // Drop observers whose root has been detached, so a component that unmounts
    // does not leave its observer alive for the rest of the session.
    var kept = [];
    for (i = 0; i < shadowObservers.length; i++) {
      var host = shadowObservers[i].root.host;
      if (host && host.isConnected) {
        kept.push(shadowObservers[i]);
      } else {
        try {
          shadowObservers[i].obs.disconnect();
        } catch (e) {
          /* ignore */
        }
      }
    }
    shadowObservers = kept;
  }

  /**
   * VIEWPORT RESIZE. There was no resize listener at all, which is the whole of
   * the "disappears when DevTools closes" bug: closing the panel resizes the
   * viewport, iHotelier re-renders the payment section, our host goes with it,
   * and the one sync the re-render's mutations triggered ran against a
   * half-updated DOM. Nothing re-ran afterwards, because mutations, popstate
   * and hashchange were the only entry points and a settled page produces none.
   *
   * Debounced, because resize fires continuously while a window is dragged and
   * refresh() re-samples the theme and re-walks every shadow root. The delay
   * also means this lands well after the host's own re-render has settled,
   * which is what makes the re-resolve succeed where the mutation-driven sync
   * failed.
   */
  var RESIZE_DEBOUNCE_MS = 200;
  var resizeTimer = null;

  function onViewportResize() {
    if (resizeTimer != null) window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(function () {
      resizeTimer = null;
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
        observer.observe(document.body, { childList: true, subtree: true, characterData: true });
      } catch (e) {
        observer = null;
      }
    }
    // Re-run every sync: shadow roots attach late and are replaced on
    // navigation, so the set is not fixed at install time.
    observeShadowRoots();
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
    startHostWatchdog();
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
    for (var i = 0; i < shadowObservers.length; i++) {
      try {
        shadowObservers[i].obs.disconnect();
      } catch (e) {
        /* ignore */
      }
    }
    shadowObservers = [];
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
    // Both timers, so destroy() cannot leave a pending callback that resurrects
    // the overlay after it has been torn down.
    if (resizeTimer != null) {
      window.clearTimeout(resizeTimer);
      resizeTimer = null;
    }
    cancelDetailsRecheck();
    stopHostWatchdog();
  }

  // =========================================================================
  // BOOT
  //
  // Fetches the merchant's plan rules, then starts either way: on the fetched
  // rules if they arrived, on DEFAULT_RULES if they did not. mews-overlay.js
  // refuses to render without them; see the DEFAULT_RULES note above for why
  // this file does not.
  // =========================================================================

  function readInstallConfig() {
    var g = null;
    try {
      g = window.__blissOverlayConfig || null;
    } catch (e) {
      g = null;
    }
    return {
      source: g && g.merchant ? "window.__blissOverlayConfig" : "built-in default",
      merchant: (g && g.merchant ? String(g.merchant) : DEFAULT_MERCHANT_SLUG).trim(),
      apiBase: (g && g.apiBase ? String(g.apiBase).trim() : "") || DEFAULT_API_BASE,
    };
  }

  /**
   * Builds CONFIG.rules from the API payload field by field, rather than
   * assigning the response wholesale: a missing field would otherwise arrive as
   * undefined and read as "no limit" inside previewEligibility. Returns null if
   * anything required is absent, which falls back rather than guessing.
   */
  function rulesFromPayload(p) {
    var required = [
      "minLeadTimeWeeks",
      "allowedFrequencies",
      "depositRequired",
      "paymentDuePolicy",
      "discountBasisPoints",
    ];
    for (var i = 0; i < required.length; i++) {
      if (p[required[i]] === undefined) return null;
    }
    return {
      minLeadTimeWeeks: p.minLeadTimeWeeks,
      maxLeadTimeWeeks: p.maxLeadTimeWeeks == null ? null : p.maxLeadTimeWeeks,
      allowedFrequencies: p.allowedFrequencies,
      minBookingAmountCents: p.minBookingAmountCents == null ? null : p.minBookingAmountCents,
      maxBookingAmountCents: p.maxBookingAmountCents == null ? null : p.maxBookingAmountCents,
      recommendedFrequency: p.recommendedFrequency == null ? null : p.recommendedFrequency,
      depositRequired: !!p.depositRequired,
      depositType: p.depositType == null ? null : p.depositType,
      depositValue: p.depositValue == null ? null : p.depositValue,
      depositMaxCents: p.depositMaxCents == null ? null : p.depositMaxCents,
      paymentDuePolicy: p.paymentDuePolicy,
      // DAYS before check-in, not months. The name is stale wire compat.
      paymentDueCustomMonths: p.paymentDueCustomMonths == null ? null : p.paymentDueCustomMonths,
      discountBasisPoints: p.discountBasisPoints,
    };
  }

  function boot() {
    var install = readInstallConfig();
    var url =
      install.apiBase.replace(/\/+$/, "") +
      "/api/v1/public/merchants/" +
      encodeURIComponent(install.merchant) +
      "/plan-rules";

    // NOTE: no pms_type gate. mews-overlay.js quits here unless the merchant is
    // on the "mews" rail. Ayres is not a Mews property and this is a visual
    // demo, so the check is gone rather than widened.
    var fellBack = function (why) {
      CONFIG.rules = DEFAULT_RULES;
      CONFIG.rulesSource = "built-in defaults (" + why + ")";
      console.warn("[bliss] using built-in default plan rules — " + why);
      start(install, url);
    };

    var request;
    try {
      // credentials omitted deliberately: the endpoint answers any origin with
      // Access-Control-Allow-Origin: *, which is incompatible with credentials.
      request = window.fetch(url, { credentials: "omit", cache: "no-store" });
    } catch (e) {
      fellBack("could not request " + url + " (" + e.message + ")");
      return;
    }

    request
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (payload) {
        var rules = payload ? rulesFromPayload(payload) : null;
        if (!rules) {
          fellBack("plan rules payload was missing required fields");
          return;
        }
        CONFIG.rules = rules;
        CONFIG.rulesSource = url;
        start(install, url);
      })
      .catch(function (e) {
        fellBack("could not load plan rules from " + url + " (" + e.message + ")");
      });
  }

  function start(install, url) {
    CONFIG.merchantSlug = install.merchant;

    refresh(); // reads the stay, decorates, observes

    var api = {
      refresh: refresh,
      destroy: function () {
        stopObserver();
        unbindKeydown();
        closeModal();
        state.triggers.forEach(function (t) {
          if (t.hostEl && t.hostEl.parentNode) t.hostEl.parentNode.removeChild(t.hostEl);
        });
        state.triggers = [];
        stripInjectedDom();
        try {
          delete window.__blissOverlay;
        } catch (e) {
          /* ignore */
        }
      },
      open: function (triggerId) {
        openModal(triggerId == null ? (state.triggers[0] || {}).id : triggerId);
      },
      state: function () {
        return state;
      },
      /** On-demand: the stay as parsed right now, and where it came from. */
      stay: function () {
        var el = findDateControl(document);
        return {
          checkinIso: state.dl && state.dl.checkinIso,
          checkoutIso: state.dl && state.dl.checkoutIso,
          nights: state.dl && state.dl.nights,
          source: state.dl && state.dl.staySource,
          controlText: state.dl && state.dl.controlText,
          controlEl: el,
          pairsParsed: el ? extractDayMonthPairs(normText(el)) : [],
        };
      },
      /**
       * Diagnostic: what text discovery found, without touching the page.
       *
       * Returns the candidate list. When that list is EMPTY it also logs what
       * the walk actually saw, because "probe() returned []" on its own cannot
       * distinguish "the shadow walk found nothing" from "the walk worked and
       * the wording on the page has changed".
       */
      probe: function () {
        var anchors = findCardAnchors(document);
        var rows = [];
        var seen = [];
        for (var i = 0; i < anchors.length; i++) {
          var card = resolveCard(anchors[i]);
          if (card && seen.indexOf(card) !== -1) continue;
          if (card) seen.push(card);
          var priced = card ? assembleCardPrice(card) : null;
          rows.push({
            label: normText(anchors[i]).slice(0, 40),
            price: priced ? priced.text : null,
            cents: priced ? priced.cents : null,
            via: priced ? priced.source : null,
            room: card ? findRoomName(card) : null,
            hasTaxLine: card ? CONFIG.rateCards.injectAfterRe.test(normText(card)) : false,
            card: card,
          });
        }
        if (!rows.length) logDeepDiagnostics();
        return rows;
      },
      config: CONFIG,
      /**
       * TEMPORARY. Prints the placement resolution chain on demand, ignoring
       * the dedupe so it always emits. Read-only, safe to call at any time.
       */
      probePlacement: function () {
        lastProbeLine = null;
        probeDetails();
      },
      __unobserve: stopObserver,
    };

    try {
      window.__blissOverlay = api;
    } catch (e) {
      /* ignore */
    }

    // ---- install report ----------------------------------------------------
    // Text-based discovery fails silently when the wording changes, so state
    // what was found rather than leaving it to be diagnosed.
    var badgeCount = 0;
    var hasDetailsTrigger = false;
    for (var bi = 0; bi < state.triggers.length; bi++) {
      if (state.triggers[bi].kind === "rate-card") badgeCount++;
      if (state.triggers[bi].kind === "details") hasDetailsTrigger = true;
    }
    console.log(
      "[bliss] ayres overlay installed. __blissOverlay.refresh() / .destroy() / .open() / .state() / .probe()\n" +
        "  merchant: " + install.merchant + " (slug from " + install.source + ")\n" +
        "  plan rules: " + CONFIG.rulesSource + "\n" +
        "  stay: " + (state.dl && state.dl.checkinIso) + " to " + (state.dl && state.dl.checkoutIso) +
        "  |  nights: " + (state.dl && state.dl.nights) +
        (state.dl && state.dl.checkoutDefaulted ? "  (checkout defaulted)" : "") + "\n" +
        "  room cards found: " + (state.lastCardCount || 0) + "  |  teasers attached: " + badgeCount + "\n" +
        "  checkout block: " + (hasDetailsTrigger ? "mounted (tax-inclusive Total Reservation basis)" : "not on this page") + "\n" +
        "  Amount basis: card nightly price x nights (tax-EXCLUSIVE), scraped from the page."
    );

    // Zero cards is EXPECTED on the checkout page, which has a reservation
    // panel and no rate cards at all. Warning there, with the full diagnostics
    // dump behind it, is a false alarm on a page where the overlay is working.
    if (!badgeCount && !hasDetailsTrigger) {
      console.warn(
        '[bliss] no room cards matched. Discovery looks for a "Current price" label, reads forward ' +
          "for the amount, then climbs to an ancestor holding a price plus \"Avg. per night\" plus " +
          '"additional taxes and fees per night". Run __blissOverlay.probe() to see what was found, and ' +
          "adjust CONFIG.rateCards.priceLabelRe / amountRe / nightlyMarkerRe / injectAfterRe if the " +
          "wording has changed."
      );
      logDeepDiagnostics();
      warnIfCardsAreInAnIframe();
    }
  }

  /**
   * What the shadow walk actually read, printed when nothing matched.
   *
   * The failure this exists for: the walk is correct, reaches every open root,
   * and the phrases on the page are simply not the phrases in CONFIG. Without
   * seeing the deepest text there is no way to tell that apart from a traversal
   * bug, which is how the pre-shadow version looked like a regex problem for as
   * long as it did.
   */
  function logDeepDiagnostics() {
    var roots = deepShadowRoots(document);
    var els = deepQueryAll(document, "*");

    // Leaf text, tagged with how deep it sits once shadow boundaries are
    // crossed. Deepest first, because that is where component content lives.
    var leaves = [];
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.shadowRoot) continue;
      if (el.children && el.children.length) continue;
      if (el.hasAttribute(BADGE_ATTR)) continue;
      var t = normText(el);
      if (!t) continue;
      leaves.push({ depth: deepDepthOf(el), text: t.slice(0, 90) });
    }
    leaves.sort(function (a, b) {
      return b.depth - a.depth;
    });

    var deepAll = String(deepText(document.body) || "").replace(/\s+/g, " ");
    var cfg = CONFIG.rateCards;

    console.warn(
      "[bliss] shadow walk diagnostics\n" +
        "  shadow roots walked: " + roots.length + "\n" +
        "  elements walked (top document + all shadow roots): " + els.length + "\n" +
        "  leaf text nodes with content: " + leaves.length + "\n" +
        "  deep text length: " + deepAll.length + " chars\n" +
        '  "Current price" labels found: ' + findPriceLabels(document).length + "\n" +
        "  document.body.innerText has the nightly marker: " +
        cfg.nightlyMarkerRe.test(String(document.body.innerText || "")) + "\n" +
        "  DEEP text has the nightly marker: " + cfg.nightlyMarkerRe.test(deepAll) + "\n" +
        "  DEEP text has the taxes line: " + cfg.injectAfterRe.test(deepAll) + "\n" +
        '  DEEP text has a "Current price" label: ' + cfg.priceLabelInlineRe.test(deepAll) + "\n" +
        "  DEEP text has an assemblable amount: " + cfg.amountRe.test(deepAll) + "\n" +
        "  DEEP text has a price-shaped string: " + cfg.priceShapeRe.test(deepAll)
    );
    console.warn("[bliss] deepest text content found (deepest first):");
    for (var j = 0; j < leaves.length && j < 25; j++) {
      console.warn("  depth " + leaves[j].depth + ": " + JSON.stringify(leaves[j].text));
    }
    if (!leaves.length) {
      console.warn(
        "  Nothing at all. Either the roots are CLOSED (no shadowRoot property is " +
          "exposed to script, and there is no way around that), or the cards are in one of the " +
          "page's iframes."
      );
    }
  }

  /** Depth from the top document, counting shadow boundaries as one step. */
  function deepDepthOf(el) {
    var d = 0;
    var cur = el;
    while (cur && d < DEEP_MAX_DEPTH * 8) {
      cur = parentAcrossShadow(cur);
      if (!cur) break;
      d++;
    }
    return d;
  }

  /**
   * Only called when the top document yielded nothing. This overlay is
   * top-document only by design (see the FRAMES note at the top), so if the
   * cards turn out to live in a same-origin iframe, say so plainly rather than
   * leaving it looking like a discovery-regex problem.
   */
  function warnIfCardsAreInAnIframe() {
    var iframes;
    try {
      iframes = document.querySelectorAll("iframe");
    } catch (e) {
      return;
    }
    for (var i = 0; i < iframes.length && i < 20; i++) {
      var doc = null;
      try {
        doc = iframes[i].contentDocument;
      } catch (e) {
        doc = null; // cross-origin
      }
      if (!doc || !doc.body) continue;
      // deepText, not textContent: an iframe on this page is just as likely to
      // render its cards in shadow roots as the top document is, and a plain
      // textContent check would report "nothing here" for a frame that has them.
      if (!CONFIG.rateCards.nightlyMarkerRe.test(String(deepText(doc.body) || ""))) continue;
      console.warn(
        '[bliss] the room cards appear to be inside a same-origin iframe (src: "' +
          (iframes[i].getAttribute("src") || "") +
          '"). This overlay is top-document only. Paste it into that frame directly, ' +
          "or port the frame-walking code from mews-overlay.js."
      );
      return;
    }
  }

  boot();
})();
