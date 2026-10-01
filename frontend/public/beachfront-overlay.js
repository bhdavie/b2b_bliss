/* eslint-disable */
/**
 * ===========================================================================
 * CONSOLE PASTE ONLY. LOCAL DEMO. NOT SHIPPED.
 *
 * Paste this whole file into the browser console, top frame, on the SynXis
 * rooms page for Beachfront Inn & Suites at Dana Point (DKN Hotels pilot):
 *
 *   https://be.synxis.com/?chain=25794&hotel=41011&arrive=...&depart=...
 *
 * Not hosted, not bundled, not referenced by any build. Same pattern as
 * frontend/public/ayres-overlay.js and frontend/public/mews-overlay.js.
 * ===========================================================================
 *
 * SCOPE OF THIS FILE: all four steps of the pilot doc.
 *   1. Rooms page: a Bliss teaser in each rate's price area; it opens the
 *      plan-picker modal.
 *   2. Checkout: a "Pay in installments before your stay" row in the SynXis
 *      payment box: a sanitised clone of the FlexPay row, directly below it.
 *   3. Choosing the row opens the same modal on the checkout total.
 *   4. "Select this plan" closes it; the row shows the chosen plan and the
 *      guest finishes the normal SynXis checkout with their card.
 * A plan confirmed on either page is kept in sessionStorage
 * (CONFIG.storageKey), so a rooms-page choice arrives at checkout preselected.
 * The checkout half is found by visible text, not confirmed selectors: see
 * CONFIG.checkout and probe().checkout.
 *
 * DECISIONS BAKED IN (see the Beachfront memory / thread of 2026-09-28):
 *   - SynXis, newer non-Angular build, a Turbo app. No shadow DOM, no iframes
 *     on the rooms page, so neither walker from the sibling overlays is here.
 *   - The Bliss teaser goes in each rate's price area, directly below the
 *     "Per Night" / "Excluding taxes and fees" lines and so above Cash Rewards
 *     and Book Now (see placementAnchor). If those lines are not found it
 *     falls back to directly after div.uplift_wrapper. For this demo
 *     CONFIG.hideUplift hides the Uplift wrapper (inline display:none, never
 *     removed, restored on teardown). Nothing else of the host's is touched.
 *   - The page's CSP blocks api.bliss-payments.com, so there is NO plan-rules
 *     fetch. RULES below are the defaults, built in.
 *   - FREE TRIAL: no Bliss fee anywhere. There is no fee function, no fee
 *     constant and no fee line, not even "$0". Per payment is stay / count.
 *   - Prices and dates come from the dataLayer first (view_item_list, arrival
 *     and departure), then the URL and the DOM as fallbacks.
 *   - We never touch card fields. This file reads text and the dataLayer only.
 *
 * CONFIRMED FROM THE ROOMS DIAGNOSTIC (values there were examples; nothing
 * here hard-codes a date or a price, everything is read live):
 *   - dataLayer: the first push carries ArrivalDt / DepartDt as YYYY-MM-DD;
 *     the ecommerce push carries arrivalDate / departureDate as MM/DD/YYYY.
 *   - view_item_list uses the older ecommerce.impressions shape
 *     {name, id, price, variant}. One room name repeats once per rate, so an
 *     item is matched on name AND variant, never name alone.
 *   - Price is per night, pre-tax ("Per Night, Excluding taxes and fees").
 *   - Room card div.thumb-cards_groupedCards, one div.thumb-cards_rate per
 *     rate inside it, Uplift in div.thumb-cards_priceContainer of each rate.
 * Every card's resolution is reported by __blissOverlay.probe() on paste.
 *
 * PLAN MATH is a verbatim port of frontend/lib/eligibility.ts via the Mews
 * copy (payment 1 is dated the booking date even on a weekend). The Ayres
 * copy is stale on that point and was not used. Do not "improve" the math.
 */
(function () {
  "use strict";

  // =========================================================================
  // RULES — built in, because the page's CSP blocks the plan-rules fetch.
  // Values match frontend/lib/api.ts DEFAULT_PLAN_RULES for the fields
  // previewEligibility consults: 6-week minimum lead time, both frequencies,
  // no deposit, no discount.
  // =========================================================================
  var RULES = {
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
  // PALETTE — verbatim from mews-overlay.js, the source of truth for the modal.
  // =========================================================================
  var BLISS_COLORS = {
    amethyst: "#8B5CF6",
    amethystHover: "#7C4DEF",
    tint40: "#D6C8FB",
    wash: "#F3EEFE",
    bone: "#FFFFFF",
    sunken: "#F4F5F7",
    hairline: "#E4E6EA",
    ink: "#17131C",
    muted: "#6E6878",
    white: "#FFFFFF",
  };

  // =========================================================================
  // CURRENCY AND LOCALE
  //
  // Identical in mews-, beachfront-, ayres- and olive-overlay.js; change all
  // four together. Nothing here assumes USD, two decimal places or US date
  // order, because a property can price in any currency and any locale.
  //
  // Every "cents" figure in these files means the currency's MINOR unit
  // (cents, pence, yen, fils). The only conversions between major and minor
  // units go through minorDigits, so JPY has no decimals and KWD has three.
  //
  // Sits above CONFIG because CONFIG's default price patterns are built from
  // the regex sources here. Everything that reads CONFIG does so at call time.
  // =========================================================================

  /**
   * ISO 4217 codes recognised in page text. A list rather than /[A-Z]{3}/ so
   * "VAT 20" or "BED 2" is never read as a price.
   */
  var ISO_CURRENCIES = (
    "USD EUR GBP CHF SEK NOK DKK ISK PLN CZK HUF RON BGN TRY CAD AUD NZD MXN BRL ARS CLP COP PEN " +
    "JPY CNY HKD TWD KRW SGD MYR THB IDR PHP VND INR LKR AED SAR QAR KWD BHD OMR JOD ILS EGP MAD ZAR KES"
  ).split(" ");

  /**
   * Symbols that name exactly one currency. "$" (USD, CAD, AUD, NZD, MXN, SGD,
   * HKD...) and "¥" (JPY or CNY) are left out on purpose: a bare one says
   * nothing, so the currency must come from page data or CONFIG instead.
   */
  var SYMBOL_CURRENCY = { "£": "GBP", "€": "EUR", "₹": "INR", "₩": "KRW", "₪": "ILS", "₺": "TRY", "₱": "PHP", "₫": "VND", "฿": "THB" };

  /** Prefixed dollars, which are unambiguous where the bare "$" is not. */
  var DOLLAR_PREFIX_CURRENCY = {
    US: "USD", CA: "CAD", C: "CAD", AU: "AUD", A: "AUD", NZ: "NZD",
    HK: "HKD", SG: "SGD", S: "SGD", MX: "MXN", R: "BRL",
  };

  /**
   * Regex SOURCES, shared by the price patterns below and by CONFIG.
   *
   * CURRENCY_MARK_SRC: anything that marks a figure as money. Wider than
   * sniffCurrency on purpose: "$", "¥" and "kr" say "this is a price" even
   * though they do not say which currency.
   *
   * NUM_SRC: a number as it appears next to a currency mark. Grouping by ".",
   * ",", apostrophe or any space (1,234.56 / 1.234,56 / 1 234,56 / 1'234.56).
   *
   * NUM_DEC_SRC: a number that looks like money WITHOUT a mark: it carries a
   * decimal part, or a 3-digit group that parseMoneyText settles per currency.
   * A plain-space group only counts with a comma decimal (1 234,56), so "Room
   * 101 154.00" reads 154.00 rather than 101154.00.
   */
  var CURRENCY_MARK_SRC =
    "(?:^|[^A-Za-z])(?:" + ISO_CURRENCIES.join("|") + "|kr|zł)(?![A-Za-z])" +
    "|[A-Z]{1,2}\\$|[$£€¥₹₩₪₺₱₫฿]";
  var NUM_SRC = "\\d{1,3}(?:[.,'’\u00a0\u202f\u2009 ]\\d{3})+(?:[.,]\\d{1,3})?|\\d+(?:[.,]\\d{1,3})?";
  var NUM_DEC_SRC =
    "\\d{1,3}(?:[.,'’\u00a0\u202f\u2009]\\d{3})*[.,]\\d{2,3}(?!\\d)" +
    "|\\d{1,3}(?: \\d{3})+,\\d{2}(?!\\d)" +
    "|\\d+[.,]\\d{2,3}(?!\\d)";

  var CURRENCY_MARK_RE = new RegExp(CURRENCY_MARK_SRC);
  var NUM_DEC_RE = new RegExp(NUM_DEC_SRC);
  /** "$1,234.56", "EUR 1.234,56", "US$ 300": mark first. Group 1 is the number. */
  var PREFIX_PRICE_RE = new RegExp("(?:" + CURRENCY_MARK_SRC + ")\\s*(" + NUM_SRC + ")");
  /**
   * "1.234,56 €", "12 000 ¥": mark after. The lookahead stops "2 $154.00"
   * reading as 2, the "$" there belonging to the number that follows it.
   */
  var SUFFIX_PRICE_RE = new RegExp("(" + NUM_SRC + ")\\s*(?:" + CURRENCY_MARK_SRC + ")(?!\\s*\\d)");
  /** A money-shaped string: marked either side, or a bare decimal amount. */
  var AMOUNT_RE = new RegExp(
    "(?:" + CURRENCY_MARK_SRC + ")\\s*(?:" + NUM_SRC + ")" +
      "|(?:" + NUM_SRC + ")\\s*(?:" + CURRENCY_MARK_SRC + ")(?!\\s*\\d)" +
      "|" + NUM_DEC_SRC
  );
  /** Loose "there is a price in here" test. */
  var PRICE_SHAPE_RE = new RegExp("(?:" + CURRENCY_MARK_SRC + ")\\s*\\d|" + NUM_DEC_SRC);

  /**
   * The first currency-marked price in `text`, mark first preferred (a mark
   * before the number is the less ambiguous form). Shaped like the regex match
   * it replaces: {index, text, num}. null when nothing in the text is marked.
   */
  function findPrice(text) {
    var s = String(text == null ? "" : text);
    var m = PREFIX_PRICE_RE.exec(s) || SUFFIX_PRICE_RE.exec(s);
    if (!m) return null;
    return { index: m.index, text: m[0].replace(/^[^A-Za-z0-9$£€¥₹₩₪₺₱₫฿]+/, ""), num: m[1] };
  }

  /** An ISO code, upper-cased, or null for anything that is not one. */
  function normCurrency(currency) {
    var c = currency == null ? "" : String(currency).trim().toUpperCase();
    return /^[A-Z]{3}$/.test(c) ? c : null;
  }

  var minorDigitsCache = {};

  /**
   * Minor-unit digits for an ISO 4217 code: 2 for USD/EUR/GBP, 0 for JPY/KRW,
   * 3 for KWD/BHD/OMR. 2 is the answer ONLY when the currency is unknown.
   */
  function minorDigits(currency) {
    var code = normCurrency(currency);
    if (!code) return 2;
    if (minorDigitsCache[code] != null) return minorDigitsCache[code];
    var d = 2;
    try {
      d = new Intl.NumberFormat("en", { style: "currency", currency: code }).resolvedOptions().maximumFractionDigits;
    } catch (e) {
      d = 2;
    }
    minorDigitsCache[code] = d;
    return d;
  }

  function minorFactor(currency) {
    return Math.pow(10, minorDigits(currency));
  }

  /** A major-unit figure (dataLayer 302.72, or "302.72") to integer minor units. */
  function majorToMinor(major, currency) {
    var n = typeof major === "number" ? major : parseFloat(String(major == null ? "" : major).replace(/[^0-9.\-]/g, ""));
    return isFinite(n) ? Math.round(n * minorFactor(currency)) : null;
  }

  /** Minor units to whole major units, rounded: 30272 USD -> 303, 303 JPY -> 303. */
  function wholeUnits(minor, currency) {
    return minor == null || !isFinite(minor) ? null : Math.round(minor / minorFactor(currency));
  }

  /**
   * The currency a piece of text names unambiguously, or null. ISO codes,
   * prefixed dollars (US$, CA$, A$, NZ$, HK$, S$, C$) and single-currency
   * symbols only. A bare "$" or "¥" returns null rather than a guess.
   */
  function sniffCurrency(text) {
    var s = String(text == null ? "" : text);
    var m = /(?:^|[^A-Za-z])(US|CA|AU|NZ|HK|SG|MX|C|A|S|R)\$/.exec(s);
    if (m) return DOLLAR_PREFIX_CURRENCY[m[1]];
    var re = /(?:^|[^A-Za-z])([A-Z]{3})(?![A-Za-z])/g;
    while ((m = re.exec(s))) {
      if (ISO_CURRENCIES.indexOf(m[1]) !== -1) return m[1];
      re.lastIndex = m.index + 1;
    }
    for (var i = 0; i < s.length; i++) {
      if (SYMBOL_CURRENCY[s.charAt(i)]) return SYMBOL_CURRENCY[s.charAt(i)];
    }
    return null;
  }

  /**
   * Integer minor units out of a rendered price, for `currency`.
   *
   * Reads the currency-marked number if there is one, else the first amount
   * with a decimal part, else the first number, so "2 nights: €300" is 300
   * and not 2300. Then decides which separator is
   * the decimal point:
   *   - both "." and "," present: the LAST one is the decimal (1.234,56 and
   *     1,234.56 both parse)
   *   - one kind, repeated: grouping (1.234.567)
   *   - one kind, once, 3 digits after it: grouping, unless the currency has
   *     3 decimals (KWD 12.345). So "¥12,000" is 12000 and "$1,234" is 1234.
   *   - otherwise: the decimal point
   * Spaces and apostrophes are always grouping. Returns null when there is no
   * number. With no currency the minor unit is assumed to be hundredths.
   */
  function parseMoneyText(text, currency) {
    var s = String(text == null ? "" : text);
    var priced = findPrice(s);
    var tok = priced ? priced.num : null;
    if (!tok) {
      var t = NUM_DEC_RE.exec(s) || /\d{1,3}(?:[.,'’\u00a0\u202f\u2009]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?/.exec(s);
      tok = t ? t[0] : null;
    }
    if (!tok) return null;
    var raw = tok.replace(/['’\u00a0\u202f\u2009 ]/g, "");
    var d = minorDigits(currency);
    var lastDot = raw.lastIndexOf(".");
    var lastComma = raw.lastIndexOf(",");
    var at = Math.max(lastDot, lastComma);
    var intPart = raw;
    var frac = "";
    if (at !== -1) {
      var sep = raw.charAt(at);
      var tail = raw.slice(at + 1);
      var isDecimal;
      if (lastDot !== -1 && lastComma !== -1) isDecimal = true;
      else if (raw.indexOf(sep) !== at) isDecimal = false;
      else if (tail.length === 3) isDecimal = d === 3;
      else isDecimal = tail.length > 0;
      if (isDecimal) {
        intPart = raw.slice(0, at);
        frac = tail;
      }
    }
    intPart = intPart.replace(/[.,]/g, "");
    if (!intPart && !frac) return null;
    var f = Math.pow(10, d);
    var minor = Number(intPart || "0") * f + (frac ? Math.round(Number("0." + frac) * f) : 0);
    return isFinite(minor) ? minor : null;
  }

  var localeCache = { key: null, value: undefined };

  /**
   * The locale every figure and date is formatted in: CONFIG.locale, else the
   * page's <html lang>, else the browser's. undefined (the runtime default)
   * when none of them is a valid tag.
   */
  function pageLocale() {
    var cands = [
      CONFIG.locale,
      document.documentElement && document.documentElement.lang,
      typeof navigator !== "undefined" ? navigator.language : null,
    ];
    var key = cands.join("|");
    if (localeCache.key === key) return localeCache.value;
    var value;
    for (var i = 0; i < cands.length && value === undefined; i++) {
      if (!cands[i]) continue;
      try {
        new Intl.NumberFormat(String(cands[i]));
        value = String(cands[i]);
      } catch (e) {
        /* not a valid tag; try the next */
      }
    }
    localeCache = { key: key, value: value };
    return value;
  }

  /**
   * "MDY" or "DMY" for an ambiguous numeric date like 04/05/2026.
   * CONFIG.dateOrder when set, else MDY for en-US and DMY for every other
   * locale.
   */
  function dateOrder() {
    var o = String(CONFIG.dateOrder || "").toUpperCase();
    if (o === "MDY" || o === "DMY") return o;
    return /^en-us\b/i.test(String(pageLocale() || "")) ? "MDY" : "DMY";
  }

  /**
   * Which of two numeric date parts is the month. A part over 12 settles it
   * (13/05 can only be day-first); otherwise dateOrder() decides. Returns
   * {month: 1-12, day} or null when neither reading is a month.
   */
  function orderDayMonth(a, b) {
    a = Number(a);
    b = Number(b);
    if (a > 12 && b > 12) return null;
    if (a > 12) return { month: b, day: a };
    if (b > 12) return { month: a, day: b };
    return dateOrder() === "MDY" ? { month: a, day: b } : { month: b, day: a };
  }

  var warnedNoCurrency = false;

  /**
   * Minor units to display text in the page locale. With a currency this is
   * Intl currency formatting. Without one it does NOT guess: it prints the
   * plain grouped number (two decimals) and says so once on the console.
   */
  function formatMinor(minor, currency, whole) {
    var code = normCurrency(currency);
    var d = minorDigits(code);
    var major = minor / Math.pow(10, d);
    var digits = whole ? 0 : d;
    var opts = { minimumFractionDigits: digits, maximumFractionDigits: digits };
    if (code) {
      opts.style = "currency";
      opts.currency = code;
    } else if (!warnedNoCurrency) {
      warnedNoCurrency = true;
      console.warn(
        "[bliss] no currency on the page data and no CONFIG.currencyFallback; amounts are shown without a currency symbol. " +
          "Set CONFIG.currencyFallback to this property's ISO code."
      );
    }
    try {
      return new Intl.NumberFormat(pageLocale(), opts).format(major);
    } catch (e) {
      return major.toFixed(digits) + (code ? " " + code : "");
    }
  }

  // =========================================================================
  // END CURRENCY AND LOCALE
  // =========================================================================

  // =========================================================================
  // CONFIG — every page-specific guess lives here.
  // Override before pasting with window.__blissBeachfrontConfig = { cards: {...} }
  // (shallow merge per section).
  // =========================================================================
  var CONFIG = {
    property: {
      name: "Beachfront Inn & Suites",
      chainId: "25794",
      hotelId: "41011",
    },

    /**
     * Hide the Uplift teaser for this demo. Hidden with an inline
     * display:none only, never removed, and restored on teardown or re-paste.
     * Independent of where the Bliss teaser goes (CONFIG.cards.placeAfterRe).
     */
    hideUplift: true,

    /**
     * Hide the FlexPay "Pay monthly from $X per month" row in the checkout
     * payment box, the same way as Uplift: inline display:none, never removed,
     * restored on teardown. Off for this demo: FlexPay shows and the Bliss row,
     * a clone of it, sits below it (see buildClone).
     */
    hideFlexPay: false,

    // -----------------------------------------------------------------------
    // CHECKOUT (steps 2 to 4). Found by VISIBLE TEXT: the checkout diagnostic
    // did not reach me (the file held chat text), so there are no confirmed
    // selectors yet. probe().checkout reports what each of these resolved to.
    // -----------------------------------------------------------------------
    checkout: {
      /** The card payment row's label. Finding it is what marks a page as checkout. */
      cardRowRe: /credit\s*\/?\s*debit\s*card/i,
      /** The FlexPay row's label. That row is what the Bliss row is cloned from. */
      flexPayRowRe: /pay\s+monthly\s+from/i,
      /**
       * The FlexPay wording replaced in the clone, from "Pay monthly from" to
       * "per month" (or "/mo"). If the end is not found, everything from
       * "Pay monthly" to the end of the label is replaced.
       */
      flexPayPhraseRe: /pay\s+monthly\s+from[\s\S]*?(per\s+month|\/\s*mo(nth)?\b)/i,
      /**
       * Price Details labels. The label must START the element's text. The
       * largest "Total" found is taken as the checkout total; subtotal and
       * taxes only decide whether that total is pre-tax or tax-inclusive.
       */
      totalLabelRe: /^(grand\s+)?total\b(?!\s+(room|tax|taxes|nights?)\b)/i,
      subtotalLabelRe: /^(sub\s*-?\s*total|room\s+(sub)?total|total\s+room\s+charges|room\s+charges)\b/i,
      taxLabelRe: /^(estimated\s+)?tax(es)?\b/i,
      /** Longest text a Price Details label element may carry, label plus amount. */
      labelMaxLength: 60,
      /**
       * The Bliss wordmark on the checkout row, Georgia Bold, in px. Set to
       * sit visually level with the FlexPay logo; tweak here.
       */
      wordmarkSizePx: 22,
      /** The wordmark's distance from the checkout row's right edge, in px. */
      wordmarkRightPx: 16,
      copy: {
        rowLabel: "Pay in installments before your stay",
        cardNote: "Your card is charged for each payment.",
      },
    },

    /** Runs only on these hosts unless CONFIG.force is true. */
    hostRe: /(^|\.)synxis\.com$/i,
    force: false,

    stay: {
      /** URL fallback. SynXis writes arrive/depart as YYYY-MM-DD. */
      checkinParams: ["arrive", "arrival", "checkin", "datein"],
      checkoutParams: ["depart", "departure", "checkout", "dateout"],
      /**
       * dataLayer keys, read at any depth up to 3; a key only counts when its
       * value parses as a date. ArrivalDt/DepartDt are YYYY-MM-DD on the first
       * push; arrivalDate/departureDate are MM/DD/YYYY on the ecommerce push.
       * parseAnyDate reads both.
       */
      dlCheckinKeys: ["ArrivalDt", "arrivalDate"],
      dlCheckoutKeys: ["DepartDt", "departureDate"],
      /**
       * The dataLayer is preferred, per the brief. Turbo keeps window.dataLayer
       * across visits, so after a date change it can briefly lag the URL. A
       * disagreement is always logged; set this true to let the URL win it.
       */
      preferUrlOnConflict: false,
    },

    items: {
      /** Events whose items/impressions carry the room prices. */
      listEvents: ["view_item_list"],
      /**
       * Events that start a new page's worth of dataLayer. Items are collected
       * backwards from the latest list event and stop at one of these, so a
       * previous search's prices (Turbo keeps the array) are not mixed in.
       */
      boundaryEventRe: /^(gtm\.js|page_?view|virtual_?page_?view|gtm\.historyChange.*|turbo.*)$/i,
      /**
       * Confirmed per night on this engine, so forced. The card's own price is
       * still compared against the dataLayer's and a disagreement is flagged in
       * probe() (usually a dataLayer that has not caught up after a Turbo
       * visit). "auto" re-enables the nightly/stay detection in resolveAmounts.
       */
      priceBasis: "night",
      defaultBasis: "night",
    },

    cards: {
      /** The Uplift teaser. The Bliss teaser is inserted as its next sibling. */
      upliftSelector: "div.uplift_wrapper",
      /** One room, holding one rate card per rate. */
      roomSelector: "div.thumb-cards_groupedCards",
      /** One rate. This is the card a teaser belongs to. */
      rateSelector: "div.thumb-cards_rate",
      roomNameSelector: "h2.app_heading1",
      rateNameSelector: "div.thumb-cards_left h3.app_subheading2 a",
      /** The price the guest pays. The struck original is del.thumb-cards_originalPrice. */
      priceSelector: "ins.thumb-cards_price span",
      /** The rate's price area, holding the price, Uplift and the basis lines. */
      priceContainerSelector: "div.thumb-cards_priceContainer",
      /**
       * The teaser goes directly after the line matching this, which is the
       * second of "Per Night" / "Excluding taxes and fees", so it lands below
       * both and above Cash Rewards and Book Now. Unmatched: after Uplift.
       */
      placeAfterRe: /excluding\s+taxes\s+and\s+fees/i,
      /**
       * FALLBACK ONLY, when a wrapper has no rate card around it: how far to
       * climb looking for the card's edge.
       */
      unitClimbMax: 12,
      /** Rates whose name matches get no teaser. A name, not a signal. */
      excludeRatePattern: null,
      marginTopPx: 8,
    },

    copy: {
      /** The basis line under the teaser and in the modal. Confirmed pre-tax. */
      basisNote: "Pre-tax",
      /**
       * Hidden for the Beachfront demo: the terms are still placeholder lines
       * and a prospect would see them.
       */
      showPlanTerms: false,
    },

    /**
     * Teaser text colours follow the background behind it (see TEASER
     * CONTRAST). null detects; "dark" or "light" forces a tone.
     */
    teaserTone: null,

    /**
     * ISO code for when the dataLayer items carry no currency. Deliberately no
     * default: with nothing to go on, amounts render as plain numbers and the
     * console says so once. Set it per property: the Beachfront pilot prices
     * in US dollars.
     * @type {string|null}
     */
    currencyFallback: "USD",

    /**
     * BCP 47 locale for amounts and dates, e.g. "en-US". null uses the page's
     * <html lang>, then the browser's language.
     * @type {string|null}
     */
    locale: null,

    /**
     * How to read an ambiguous slash date such as 04/05/2026 ("MDY" or "DMY").
     * ISO dates and slash dates with a part over 12 never need it. null derives
     * it from the locale: MDY for en-US, DMY otherwise. The SynXis ecommerce
     * push writes arrivalDate as MM/DD/YYYY, but ArrivalDt (ISO) is preferred
     * whenever it is present, so this only matters when it is not.
     * @type {"MDY"|"DMY"|null}
     */
    dateOrder: null,

    /** Where the confirmed plan is kept for the checkout steps. */
    storageKey: "bliss.beachfront.plan",

    brand: { radius: "4px", radiusCard: "16px", radiusPill: "999px" },

    /** The receipt replaces the button and the modal stays open. */
    closeModalOnConfirm: false,
  };

  (function applyOverrides() {
    var o = window.__blissBeachfrontConfig;
    if (!o || typeof o !== "object") return;
    Object.keys(o).forEach(function (k) {
      if (CONFIG[k] && typeof CONFIG[k] === "object" && !(CONFIG[k] instanceof RegExp) && typeof o[k] === "object") {
        for (var kk in o[k]) CONFIG[k][kk] = o[k][kk];
      } else {
        CONFIG[k] = o[k];
      }
    });
  })();

  // =========================================================================
  // MONEY TEXT PARSING — same as mews-overlay.js
  // =========================================================================

  /** Unambiguous currency last seen on a scraped price. See sniffCurrency. */
  var currencyHint = null;

  /**
   * Integer minor units out of a rendered price string, in the currency the
   * text names unambiguously, else the page's (see cur). The currency decides
   * the decimal places, so it is settled before the number is read.
   */
  function parseMoneyTextToCents(text, currency) {
    var sniffed = sniffCurrency(text);
    if (sniffed) currencyHint = sniffed;
    return parseMoneyText(text, currency || sniffed || cur(null));
  }

  /**
   * A dataLayer price (major units, number or string) to integer minor units
   * of `currency`.
   */
  function dlPriceToCents(v, currency) {
    if (v == null || v === "") return null;
    var n = majorToMinor(v, currency);
    return n != null && n > 0 ? n : null;
  }

  // =========================================================================
  // ELIGIBILITY — verbatim port of frontend/lib/eligibility.ts, via
  // mews-overlay.js minus its Mews-only additions (extraInstallmentCents for
  // the fee, basis_points deposits). Do not edit in isolation.
  // =========================================================================

  var FREQUENCY_DAYS = { biweekly: 14, monthly: 30 };
  var MIN_FINAL_PAYMENT_BUFFER_DAYS = 3;
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
    var effectiveBuffer = Math.max(MIN_FINAL_PAYMENT_BUFFER_DAYS, dueOffsetDays);
    var usable = days - effectiveBuffer;
    if (usable < 0) return null;

    var dueDates;
    if (frequency === "monthly") {
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
        var due = addDays(today, (startMultiplier + i) * intervalDays);
        // Payment 1 without a deposit is charged at checkout, so it stays today
        // even on a weekend. Mirrors PlanEligibilityService.
        var isPaymentOne = !hasDeposit && i === 0;
        dueDates.push(formatDate(isPaymentOne ? due : rollForwardToWeekday(due)));
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

  function monthlyDueDates(today, cutoff, hasDeposit) {
    var dates = [];
    if (!hasDeposit) {
      dates.push(formatDate(today));
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

  function rollForwardToWeekday(d) {
    var day = d.getDay();
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

  function startOfToday() {
    var n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate());
  }

  // =========================================================================
  // DATES
  // =========================================================================

  /**
   * Any of the date shapes seen on booking engines, to a LOCAL date:
   * YYYY-MM-DD (with or without a time after it), YYYYMMDD, and NN/NN/YYYY
   * (also with - or .). The slash form is month-first or day-first depending
   * on the property: a part over 12 settles it, otherwise orderDayMonth uses
   * CONFIG.dateOrder or the page locale. Overflowed dates (02/31) are
   * rejected rather than rolled into March.
   */
  function parseAnyDate(v) {
    if (v == null) return null;
    var s = String(v).trim();
    var y, mo, d, m;
    if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s))) {
      y = +m[1]; mo = +m[2]; d = +m[3];
    } else if ((m = /^(\d{4})(\d{2})(\d{2})$/.exec(s))) {
      y = +m[1]; mo = +m[2]; d = +m[3];
    } else if ((m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/.exec(s))) {
      var md = orderDayMonth(m[1], m[2]);
      if (!md) return null;
      mo = md.month; d = md.day; y = +m[3];
    } else {
      return null;
    }
    var date = new Date(y, mo - 1, d);
    if (isNaN(date.getTime()) || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
    return date;
  }

  function queryParams(search) {
    var out = {};
    var raw = String(search || "").replace(/^\?/, "");
    if (!raw) return out;
    raw.split("&").forEach(function (part) {
      if (!part) return;
      var eq = part.indexOf("=");
      var k = eq === -1 ? part : part.slice(0, eq);
      var v = eq === -1 ? "" : part.slice(eq + 1);
      try {
        k = decodeURIComponent(k.replace(/\+/g, " "));
        v = decodeURIComponent(v.replace(/\+/g, " "));
      } catch (e) {
        /* keep the raw value */
      }
      // Case-insensitive lookups: SynXis has shipped both arrive and Arrive.
      k = k.toLowerCase();
      if (out[k] === undefined) out[k] = v;
    });
    return out;
  }

  function firstParam(params, names) {
    for (var i = 0; i < names.length; i++) {
      var v = params[names[i].toLowerCase()];
      if (v != null && String(v).trim() !== "") return String(v).trim();
    }
    return null;
  }

  // =========================================================================
  // DATALAYER
  //
  // Entries arrive in two shapes: plain objects ({event, ecommerce, ...}) and
  // gtag argument lists (["event", "view_item_list", {items: [...]}]). Both
  // are normalised to the object shape before anything reads them.
  //
  // Turbo does not reload the window, so the array keeps every entry from
  // every visit. Every read walks BACKWARDS and takes the latest occurrence.
  // =========================================================================

  function dlArray() {
    var dl = window.dataLayer;
    return dl && typeof dl.length === "number" ? dl : [];
  }

  function normEntry(e) {
    if (!e || typeof e !== "object") return null;
    if (typeof e.length === "number" && e[0] === "event" && typeof e[1] === "string") {
      var o = { event: e[1] };
      var p = e[2];
      if (p && typeof p === "object") for (var k in p) o[k] = p[k];
      return o;
    }
    return e;
  }

  /** Every [key, value] under obj, depth-limited, for pattern matching keys. */
  function eachKey(obj, depth, fn) {
    if (!obj || typeof obj !== "object" || depth > 3) return;
    for (var k in obj) {
      if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
      var v = obj[k];
      fn(k, v);
      if (v && typeof v === "object" && !(typeof v.length === "number" && v.length > 20)) eachKey(v, depth + 1, fn);
    }
  }

  /** True for the unambiguous date shapes: YYYY-MM-DD and YYYYMMDD. */
  function isIsoDateText(v) {
    return /^\d{4}-?\d{2}-?\d{2}/.test(String(v).trim());
  }

  /**
   * Stay dates from the dataLayer, latest entry first. ISO-valued keys
   * (ArrivalDt) are preferred over slash-valued ones (arrivalDate) anywhere in
   * the window, because a slash date's day/month order is a guess on a page
   * whose locale is not known; the slash value is used only when no ISO one
   * exists.
   */
  function stayFromDataLayer() {
    var dl = dlArray();
    var out = { checkin: null, checkout: null, checkinKey: null, checkoutKey: null, hotelName: null, chainName: null };
    var slash = { checkin: null, checkout: null, checkinKey: null, checkoutKey: null };
    function take(side, k, v) {
      var target = isIsoDateText(v) ? out : slash;
      if (target[side]) return;
      var dt = parseAnyDate(v);
      if (dt) { target[side] = dt; target[side + "Key"] = k; }
    }
    for (var i = dl.length - 1; i >= 0 && i >= dl.length - 400; i--) {
      var e = normEntry(dl[i]);
      if (!e) continue;
      eachKey(e, 0, function (k, v) {
        if (v == null || typeof v === "object") return;
        if (CONFIG.stay.dlCheckinKeys.indexOf(k) !== -1) take("checkin", k, v);
        if (CONFIG.stay.dlCheckoutKeys.indexOf(k) !== -1) take("checkout", k, v);
        if (!out.hotelName && /^hotel_?(nm|name)$/i.test(k)) out.hotelName = String(v);
        if (!out.chainName && /^chain_?(nm|name)$/i.test(k)) out.chainName = String(v);
      });
      if (out.checkin && out.checkout && out.hotelName) break;
    }
    if (!out.checkin) { out.checkin = slash.checkin; out.checkinKey = slash.checkinKey; }
    if (!out.checkout) { out.checkout = slash.checkout; out.checkoutKey = slash.checkoutKey; }
    return out;
  }

  function isListEntry(e) {
    if (!e) return false;
    if (e.event && CONFIG.items.listEvents.indexOf(e.event) !== -1) return true;
    return !!(e.ecommerce && e.ecommerce.impressions && e.ecommerce.impressions.length);
  }

  function normItem(it, e) {
    if (!it || typeof it !== "object") return null;
    var ecom = e.ecommerce || {};
    var name = it.item_name != null ? it.item_name : it.name;
    var currency = it.currency || ecom.currency || ecom.currencyCode || e.currency || null;
    // Converted in the item's own currency: a JPY price has no minor digits.
    var cents = dlPriceToCents(it.price, currency || CONFIG.currencyFallback);
    if (name == null || cents == null) return null;
    return {
      name: String(name).replace(/\s+/g, " ").trim(),
      variant: it.item_variant != null ? String(it.item_variant) : it.variant != null ? String(it.variant) : null,
      id: it.item_id != null ? String(it.item_id) : it.id != null ? String(it.id) : null,
      priceCents: cents,
      currency: currency,
    };
  }

  /**
   * The rooms currently listed: items from the latest list event, plus any list
   * events immediately before it (SynXis may push one per room), stopping at a
   * page boundary so a previous search's prices never mix in.
   */
  function readItems() {
    var dl = dlArray();
    var items = [];
    var seen = {};
    var events = 0;
    var started = false;
    for (var i = dl.length - 1; i >= 0; i--) {
      var e = normEntry(dl[i]);
      if (!e) continue;
      if (isListEntry(e)) {
        started = true;
        events++;
        var ecom = e.ecommerce || {};
        var list = ecom.items || ecom.impressions || e.items || [];
        for (var j = 0; j < list.length; j++) {
          var it = normItem(list[j], e);
          if (!it) continue;
          var key = it.name + "|" + (it.variant || "") + "|" + (it.id || "");
          if (seen[key]) continue; // latest wins; we are walking backwards
          seen[key] = true;
          items.push(it);
        }
      } else if (started && e.event && CONFIG.items.boundaryEventRe.test(String(e.event))) {
        break;
      }
    }
    return { items: items, events: events };
  }

  // =========================================================================
  // STAY — dataLayer first, URL as fallback, same shape the modal reads.
  // =========================================================================

  var lastStayLogKey = null;

  function readStay() {
    var dlStay = stayFromDataLayer();
    var params = queryParams(window.location.search);
    var urlIn = parseAnyDate(firstParam(params, CONFIG.stay.checkinParams));
    var urlOut = parseAnyDate(firstParam(params, CONFIG.stay.checkoutParams));

    var useUrl = !dlStay.checkin || !dlStay.checkout;
    var conflict =
      !useUrl && urlIn && urlOut &&
      (formatDate(urlIn) !== formatDate(dlStay.checkin) || formatDate(urlOut) !== formatDate(dlStay.checkout));
    if (conflict && CONFIG.stay.preferUrlOnConflict) useUrl = true;

    var checkin = useUrl ? urlIn : dlStay.checkin;
    var checkout = useUrl ? urlOut : dlStay.checkout;
    if (checkin && checkout && daysBetween(checkin, checkout) <= 0) checkout = null;
    var source = useUrl
      ? checkin ? "URL query string" : "none"
      : "dataLayer (" + dlStay.checkinKey + " / " + dlStay.checkoutKey + ")";

    var stay = {
      source: source,
      conflict: conflict
        ? { dataLayer: [formatDate(dlStay.checkin), formatDate(dlStay.checkout)], url: [formatDate(urlIn), formatDate(urlOut)] }
        : null,
      checkin: checkin,
      checkout: checkout,
      checkinIso: checkin ? formatDate(checkin) : null,
      checkoutIso: checkout ? formatDate(checkout) : null,
      nights: checkin && checkout ? daysBetween(checkin, checkout) : null,
      hotelName: dlStay.hotelName,
      chainName: dlStay.chainName,
      chainParam: params.chain || null,
      hotelParam: params.hotel || null,
    };

    var key = stay.checkinIso + "|" + stay.checkoutIso + "|" + source + "|" + !!conflict;
    if (key !== lastStayLogKey) {
      lastStayLogKey = key;
      if (stay.checkin && stay.nights) {
        console.log("[bliss] stay: " + stay.checkinIso + " to " + stay.checkoutIso + ", " + stay.nights + " nights, from " + source);
      } else {
        console.warn(
          "[bliss] no usable stay dates in the dataLayer or the URL. The saved plan's dates are used if there is one; otherwise nothing shows."
        );
      }
      if (conflict) {
        console.warn(
          "[bliss] dataLayer and URL disagree on dates (" + JSON.stringify(stay.conflict) + "). Using " +
            (useUrl ? "the URL" : "the dataLayer") + ". Set CONFIG.stay.preferUrlOnConflict to change."
        );
      }
    }
    return stay;
  }

  // =========================================================================
  // CARD DISCOVERY — anchored on the Uplift wrapper
  //
  // Each rate card (div.thumb-cards_rate) carries one div.uplift_wrapper in
  // its price container, so the wrapper is the handle and the rate card around
  // it is the unit a teaser belongs to. The room name comes from the room card
  // above it, the rate name and price from the rate card itself.
  //
  // FALLBACK, for a wrapper with no rate card around it: the unit is the
  // largest ancestor containing no OTHER Uplift wrapper, which is what stops
  // two rates collapsing into one.
  // =========================================================================

  var BADGE_ATTR = "data-bliss-badge";
  var MODAL_HOST_ID = "bliss-plan-modal-host";
  // Prices in free text are found with findPrice (CURRENCY AND LOCALE): any
  // currency mark or ISO code, before or after the number, any separators.
  var NON_TEXT_TAGS = { SCRIPT: 1, STYLE: 1, TEMPLATE: 1, NOSCRIPT: 1, SVG: 1 };

  function upliftEls() {
    try {
      return [].slice.call(document.querySelectorAll(CONFIG.cards.upliftSelector));
    } catch (e) {
      return [];
    }
  }

  function countUplifts(el) {
    try {
      return el.querySelectorAll(CONFIG.cards.upliftSelector).length;
    } catch (e) {
      return 0;
    }
  }

  function closestSafe(el, sel) {
    try {
      return (el && el.closest && el.closest(sel)) || null;
    } catch (e) {
      return null;
    }
  }

  function firstText(scope, sel) {
    if (!scope) return null;
    var el = null;
    try {
      el = scope.querySelector(sel);
    } catch (e) {
      el = null;
    }
    var t = el ? norm(el.textContent) : "";
    return t || null;
  }

  function unitFor(uplift) {
    var rate = closestSafe(uplift, CONFIG.cards.rateSelector);
    if (rate) return rate;
    var node = uplift;
    for (var d = 0; d < CONFIG.cards.unitClimbMax; d++) {
      var p = node.parentElement;
      if (!p || p === document.body || p === document.documentElement) break;
      if (countUplifts(p) > 1) break;
      node = p;
    }
    return node;
  }

  function isStruck(el) {
    var tag = el.tagName ? el.tagName.toLowerCase() : "";
    if (tag === "s" || tag === "del" || tag === "strike") return true;
    try {
      return String(getComputedStyle(el).textDecorationLine || "").indexOf("line-through") !== -1;
    } catch (e) {
      return false;
    }
  }

  /**
   * Visible text under `node`, skipping the Uplift widget (its own "$X/mo"
   * would otherwise be read as the room price), our teasers, and struck-through
   * figures (a discounted rate's crossed-out original).
   */
  function cardText(node, skipStruck) {
    if (!node) return "";
    if (node.nodeType === 3) return node.nodeValue || "";
    if (node.nodeType !== 1) return "";
    if (NON_TEXT_TAGS[node.tagName.toUpperCase()]) return "";
    if (node.hasAttribute(BADGE_ATTR)) return "";
    try {
      if (node.matches(CONFIG.cards.upliftSelector)) return "";
    } catch (e) {
      /* ignore */
    }
    if (skipStruck && isStruck(node)) return "";
    var s = "";
    for (var i = 0; i < node.childNodes.length; i++) s += " " + cardText(node.childNodes[i], skipStruck);
    return s;
  }

  function norm(s) {
    return String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  }

  function normKey(s) {
    return norm(s).toLowerCase();
  }

  /**
   * The card's displayed price, nearest the Uplift wrapper first: its own price
   * area, then outward to the card edge. Also reports what the nearby text says
   * the price is ("night" or "stay"), which resolveAmounts uses to settle the
   * dataLayer's basis.
   */
  function domPrice(uplift, unit) {
    // Confirmed markup first: the price is ins.thumb-cards_price, and the struck
    // original sits in a del beside it, so selecting the ins never reads it.
    // Spans are joined because the currency mark and the amount may be
    // separate spans. Parsed whole, so the mark can settle the currency.
    var spans = [];
    try {
      spans = unit ? [].slice.call(unit.querySelectorAll(CONFIG.cards.priceSelector)) : [];
    } catch (e) {
      spans = [];
    }
    if (spans.length) {
      var joined = norm(spans.map(function (s) { return s.textContent; }).join(" "));
      var joinedCents = parseMoneyTextToCents(joined);
      if (joinedCents != null) return { cents: joinedCents, text: joined, basis: "night", near: joined, via: "priceSelector" };
    }

    var scope = uplift.parentElement;
    for (var d = 0; scope && d < CONFIG.cards.unitClimbMax; d++) {
      var text = norm(cardText(scope, true));
      var m = findPrice(text);
      if (m) {
        var near = text.slice(Math.max(0, m.index - 60), m.index + m.text.length + 60);
        var basis = /(per|\/|a)\s*night|nightly|avg/i.test(near)
          ? "night"
          : /total|for\s+\d+\s+nights|per\s+stay/i.test(near)
            ? "stay"
            : null;
        return { cents: parseMoneyTextToCents(m.text), text: m.text, basis: basis, near: near, via: "text scan" };
      }
      if (scope === unit) break;
      scope = scope.parentElement;
    }
    return null;
  }

  function roomHeading(unit) {
    var hs = unit.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"]');
    for (var i = 0; i < hs.length; i++) {
      var t = norm(cardText(hs[i], false));
      if (t) return t.slice(0, 90);
    }
    return null;
  }

  function near(a, b) {
    if (a == null || b == null) return false;
    return Math.abs(a - b) <= Math.max(1, Math.round(Math.abs(b) * 0.01));
  }

  /**
   * The dataLayer item for a rate card, by room name AND rate name, both exact
   * (case and whitespace aside). One room name repeats once per rate, so a
   * name-only match would quote another rate's price.
   *
   * If the rate name does not match any variant exactly, the item with this
   * room name whose price equals the card's own is taken instead. If that
   * fails too there is NO match, and the card's own price is used: guessing
   * among a room's rates would put a confident wrong figure on the card.
   */
  function matchItemByNames(room, rate, items, dom) {
    var roomKey = normKey(room);
    var rateKey = normKey(rate);
    var sameRoom = items.filter(function (it) {
      return normKey(it.name) === roomKey;
    });
    for (var i = 0; i < sameRoom.length; i++) {
      if (rateKey && normKey(sameRoom[i].variant) === rateKey) return { item: sameRoom[i], how: "name + variant" };
    }
    if (dom && dom.cents != null) {
      var byPrice = sameRoom.filter(function (it) {
        return near(it.priceCents, dom.cents);
      });
      if (byPrice.length === 1) return { item: byPrice[0], how: "name + card price (variant did not match)" };
    }
    return { item: null, how: sameRoom.length ? "room found, rate not matched" : "room not in dataLayer" };
  }

  /**
   * FALLBACK, for a card whose room/rate names were not found: its name must
   * appear in the card's text,
   * longest name first so "King" cannot steal "King Ocean View". Among items
   * with that name (one per rate), prefer the one whose variant also appears,
   * then the one whose price matches the card's, then the lowest.
   */
  function matchItem(unitTextKey, items, dom, nights) {
    var best = [];
    var bestLen = 0;
    for (var i = 0; i < items.length; i++) {
      var n = normKey(items[i].name);
      if (!n || unitTextKey.indexOf(n) === -1) continue;
      if (n.length > bestLen) {
        best = [items[i]];
        bestLen = n.length;
      } else if (n.length === bestLen) {
        best.push(items[i]);
      }
    }
    if (best.length <= 1) return best[0] || null;
    var withVariant = best.filter(function (it) {
      return it.variant && unitTextKey.indexOf(normKey(it.variant)) !== -1;
    });
    if (withVariant.length === 1) return withVariant[0];
    var pool = withVariant.length ? withVariant : best;
    if (dom && dom.cents != null) {
      for (var j = 0; j < pool.length; j++) {
        var p = pool[j].priceCents;
        if (near(p, dom.cents) || (nights && (near(p, dom.cents * nights) || near(p * nights, dom.cents)))) return pool[j];
      }
    }
    return pool.reduce(function (a, b) {
      return b.priceCents < a.priceCents ? b : a;
    });
  }

  /**
   * Nightly figure and stay total for a card, from the dataLayer item when
   * matched and the DOM otherwise. The dataLayer's basis (nightly or stay) is
   * unverified, so in "auto" mode it is settled against the card's own price:
   *   item ~ dom             same basis as the card's own text says
   *   item ~ dom x nights    item is the stay total, card is nightly
   *   item x nights ~ dom    item is nightly, card is the stay total
   * Anything else falls back to CONFIG.items.defaultBasis and is flagged.
   */
  function resolveAmounts(item, dom, nights) {
    if (!nights || nights <= 0) return null;
    var forced = CONFIG.items.priceBasis === "night" || CONFIG.items.priceBasis === "stay" ? CONFIG.items.priceBasis : null;
    var cents, basis, source, how;
    if (item) {
      cents = item.priceCents;
      source = "dataLayer";
      if (forced) {
        basis = forced;
        how =
          dom && dom.cents != null && !near(cents, forced === "night" ? dom.cents : dom.cents * nights)
            ? forced + " (CONFIG); MISMATCH with card price " + dom.text
            : forced + " (CONFIG)";
      } else if (dom && dom.cents != null) {
        var domBasis = dom.basis || CONFIG.items.defaultBasis;
        if (near(cents, dom.cents)) {
          basis = domBasis; how = "matches card price (" + domBasis + ")";
        } else if (near(cents, dom.cents * nights)) {
          basis = "stay"; how = "equals card price x nights";
        } else if (near(cents * nights, dom.cents)) {
          basis = "night"; how = "card price is item x nights";
        } else {
          basis = CONFIG.items.defaultBasis; how = "MISMATCH with card price " + dom.text + ", assumed " + basis;
        }
      } else {
        basis = CONFIG.items.defaultBasis; how = "no card price to compare, assumed " + basis;
      }
    } else if (dom && dom.cents != null) {
      cents = dom.cents;
      source = "dom";
      basis = forced || dom.basis || CONFIG.items.defaultBasis;
      how = dom.basis ? "card text says " + dom.basis : "assumed " + basis;
    } else {
      return null;
    }
    return {
      source: source,
      basis: basis,
      how: how,
      nightlyCents: basis === "night" ? cents : Math.round(cents / nights),
      stayCents: basis === "night" ? cents * nights : cents,
    };
  }

  // =========================================================================
  // FORMATTING AND COPY
  // =========================================================================

  /** Minor units in the page locale. No currency: a plain number, see formatMinor. */
  function money(cents, currency) {
    if (cents == null || !isFinite(cents)) return "";
    return formatMinor(cents, currency, false);
  }

  /** Same locale as money(). */
  function shortDate(iso) {
    var d = parseAnyDate(iso);
    if (!d) return iso || "";
    return d.toLocaleDateString(pageLocale(), { month: "short", day: "numeric", year: "numeric" });
  }

  function planLabel(frequency) {
    return frequency === "biweekly" ? "Every 2 weeks" : "Monthly";
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

  // PLACEHOLDER, kept from the sibling overlays: the real plan terms have not
  // been written, and inventing them would put terms a guest could rely on
  // onto a live booking page.
  var PLAN_TERMS_LINES = ["PLACEHOLDER LINE ONE", "PLACEHOLDER LINE TWO", "PLACEHOLDER LINE THREE"];

  // =========================================================================
  // STATE, PERSISTENCE, TEARDOWN
  // =========================================================================

  var state = {
    stay: null,
    items: [],
    itemEvents: 0,
    theme: null,
    triggers: [], // {id, upliftEl, unitEl, hostEl, root, key, name, ..., preview, sig}
    planChoice: null,
    modal: null, // {triggerId, selected, justConfirmed, scheduleOpen, termsOpen}
    nextId: 1,
  };

  function savePlan() {
    try {
      if (state.planChoice) sessionStorage.setItem(CONFIG.storageKey, JSON.stringify(state.planChoice));
      else sessionStorage.removeItem(CONFIG.storageKey);
    } catch (e) {
      /* storage blocked: the plan still lives in memory for this window */
    }
  }

  /** A stored plan only counts for the stay it was chosen against. */
  function loadPlan(stay) {
    try {
      var raw = sessionStorage.getItem(CONFIG.storageKey);
      if (!raw) return null;
      var p = JSON.parse(raw);
      if (!p || !stay || p.checkin !== stay.checkinIso || p.checkout !== stay.checkoutIso) return null;
      return p;
    } catch (e) {
      return null;
    }
  }

  // Marks a host element we hid (the Uplift wrapper, the FlexPay row), holding
  // its previous inline display so teardown puts back exactly what the page had.
  var HIDDEN_ATTR = "data-bliss-hidden";

  function hideHostEl(el) {
    if (!el || el.hasAttribute(HIDDEN_ATTR)) return;
    el.setAttribute(HIDDEN_ATTR, el.style.getPropertyValue("display") || "");
    // !important so the widget's own script setting display cannot bring it back.
    el.style.setProperty("display", "none", "important");
  }

  function restoreHidden() {
    [].slice.call(document.querySelectorAll("[" + HIDDEN_ATTR + "]")).forEach(function (el) {
      var prev = el.getAttribute(HIDDEN_ATTR);
      el.style.removeProperty("display");
      if (prev) el.style.setProperty("display", prev);
      el.removeAttribute(HIDDEN_ATTR);
    });
  }

  function stripInjectedDom() {
    [].slice.call(document.querySelectorAll("[" + BADGE_ATTR + "]")).forEach(function (el) {
      if (el.parentNode) el.parentNode.removeChild(el);
    });
    restoreHidden();
    var m = document.getElementById(MODAL_HOST_ID);
    if (m && m.parentNode) m.parentNode.removeChild(m);
  }

  (function destroyExisting() {
    var prev = window.__blissOverlay;
    if (prev) {
      ["__destroy", "__unhook", "__unobserve"].forEach(function (fn) {
        try {
          if (typeof prev[fn] === "function") prev[fn]();
        } catch (e) {
          /* ignore */
        }
      });
      try {
        delete window.__blissOverlay;
      } catch (e) {
        window.__blissOverlay = undefined;
      }
    }
    stripInjectedDom();
  })();

  // =========================================================================
  // STYLES — trigger and modal CSS from mews-overlay.js, minus the Details
  // step rules this file does not have.
  // =========================================================================

  function sampleFont(el) {
    try {
      return getComputedStyle(el || document.body).fontFamily || "system-ui, sans-serif";
    } catch (e) {
      return "system-ui, sans-serif";
    }
  }

  // -------------------------------------------------------------------------
  // TEASER CONTRAST
  //
  // The teaser sits on the host's own background, which on Beachfront is a
  // dark navy card, so the palette's ink and muted text disappear on it. The
  // colours are chosen from the background actually behind the teaser: the
  // first ancestor with a mostly opaque background colour, else the body's,
  // else white. A background IMAGE cannot be read this way; set
  // CONFIG.teaserTone to "dark" or "light" to force it if that ever matters.
  // -------------------------------------------------------------------------

  var TEASER_TONES = {
    // On a dark background: white main line, light grey support line (about
    // 9:1 on a navy like #1B2A4A, comfortably above the 4.5:1 floor).
    dark: { text: BLISS_COLORS.white, sub: "#CFCAD8" },
    // On a light background: the palette's own ink and muted.
    light: { text: BLISS_COLORS.ink, sub: BLISS_COLORS.muted },
  };

  function parseRgb(str) {
    var m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+%?))?/.exec(str || "");
    if (!m) return null;
    var a = m[4] == null ? 1 : m[4].slice(-1) === "%" ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return { r: +m[1], g: +m[2], b: +m[3], a: a };
  }

  /** WCAG relative luminance, 0 (black) to 1 (white). */
  function relLuminance(c) {
    function ch(v) {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    }
    return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
  }

  function backgroundBehind(el) {
    for (var n = el, d = 0; n && n.nodeType === 1 && d < 40; n = n.parentElement, d++) {
      var bg = null;
      try {
        bg = parseRgb(getComputedStyle(n).backgroundColor);
      } catch (e) {
        bg = null;
      }
      if (bg && bg.a >= 0.5) return bg;
    }
    return { r: 255, g: 255, b: 255, a: 1 };
  }

  function teaserTone(el) {
    if (CONFIG.teaserTone === "dark" || CONFIG.teaserTone === "light") return CONFIG.teaserTone;
    // 0.18 is where white and near-black text have equal contrast against the
    // background; darker than that, white text wins.
    return relLuminance(backgroundBehind(el)) < 0.18 ? "dark" : "light";
  }

  function baseCss(font) {
    return ":host{all:initial}*{box-sizing:border-box;margin:0;padding:0;font-family:" + font + "}";
  }

  function triggerCss(font) {
    var c = BLISS_COLORS;
    return (
      baseCss(font) +
      ".trig{display:block;width:100%;margin:0;padding:0;background:none;border:0;" +
      "border-radius:0;box-shadow:none;color:" + c.ink + ";font-size:12px;line-height:1.45;" +
      "cursor:pointer;text-align:left;white-space:normal;overflow-wrap:break-word}" +
      ".trig:hover .amt{text-decoration:underline}" +
      ".trig:focus-visible{outline:2px solid " + c.amethyst + ";outline-offset:2px}" +
      ".tick{display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;" +
      "border-radius:" + CONFIG.brand.radius + ";background:" + c.amethyst + ";color:" + c.white + ";font-size:10px;" +
      "margin-right:7px;vertical-align:middle}" +
      ".sep{margin:0 5px;opacity:.55}" +
      ".amt{font-weight:600}" +
      ".sub{display:block;margin-top:2px;font-size:11px;font-weight:400;color:" + c.muted + "}"
    );
  }

  function modalCss(font) {
    var b = CONFIG.brand;
    var c = BLISS_COLORS;
    return (
      baseCss(font) +
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
      ".fine{font-size:11px;color:" + c.muted + ";margin-bottom:12px;line-height:1.4}" +
      ".disc{display:block;width:100%;text-align:left;margin:2px 0 8px;padding:8px 0;background:none;" +
      "border:0;border-top:1px solid " + c.hairline + ";color:" + c.ink +
      ";font-size:12px;font-weight:600;cursor:pointer}" +
      ".sched,.terms{margin:0 0 12px;background:" + c.sunken + ";border:1px solid " + c.hairline +
      ";border-radius:" + b.radius + "}" +
      ".sched .row,.terms .row{display:flex;align-items:center;gap:10px;padding:8px 12px;font-size:12px;" +
      "border-bottom:1px solid " + c.hairline + "}" +
      ".sched .row:last-child,.terms .row:last-child{border-bottom:0}" +
      ".terms .row{color:" + c.muted + "}" +
      ".sched .n{width:18px;color:" + c.muted + "}" +
      ".sched .d{color:" + c.ink + "}" +
      ".sched .v{margin-left:auto;font-weight:600;color:" + c.ink + "}" +
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
      ".tag{display:inline-block;font-size:9px;letter-spacing:.4px;text-transform:uppercase;padding:2px 6px;" +
      "border-radius:" + b.radius + ";background:" + c.wash + ";border:1px solid " + c.amethyst + ";color:" + c.ink +
      ";margin-left:6px;vertical-align:middle}" +
      ".cta{width:100%;padding:12px;border:0;border-radius:" + b.radiusPill + ";background:" + c.amethyst +
      ";color:" + c.white + ";font-size:13px;font-weight:600;cursor:pointer;margin-top:4px}" +
      ".cta:hover{background:" + c.amethystHover + "}" +
      ".cta[disabled]{background:" + c.hairline + ";color:" + c.muted + ";cursor:default}" +
      ".note{font-size:11px;color:" + c.muted + ";margin-top:10px;line-height:1.45}" +
      ".msg{font-size:12px;color:" + c.muted + ";line-height:1.5}" +
      ".plan{margin:2px 0 0;font-size:14px;font-weight:600;line-height:1.4;color:" + c.ink + "}" +
      ".confirmed{margin-top:4px;padding:12px 0;border-top:1px solid " + c.hairline +
      ";font-size:13px;line-height:1.45;color:" + c.ink + "}" +
      ".textbtn{display:block;width:100%;margin-top:10px;padding:6px 0;background:none;border:0;" +
      "font-size:13px;line-height:1.45;color:" + c.muted + ";cursor:pointer;text-align:center}" +
      ".textbtn:hover{text-decoration:underline}" +
      ".pwr{padding:0 24px 20px;text-align:center;font-size:11px;font-weight:400;color:" + c.muted + ";line-height:1.4}" +
      ".pwr .wm{font-family:Georgia,serif;font-weight:700;color:" + c.amethyst + "}" +
      "@media (max-width:420px){.scrim{align-items:flex-end;padding:0}" +
      ".bliss-card{width:100%;max-width:100%;max-height:88vh;border-radius:" + b.radiusCard + " " + b.radiusCard + " 0 0}}"
    );
  }

  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
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
  }

  // =========================================================================
  // PLAN MATH PER CARD
  // =========================================================================

  function optionByFrequency(preview, frequency) {
    if (!preview) return null;
    for (var i = 0; i < preview.options.length; i++) {
      if (preview.options[i].frequency === frequency) return preview.options[i];
    }
    return null;
  }

  function defaultSelected(preview) {
    if (!preview || !preview.options.length) return null;
    for (var i = 0; i < preview.options.length; i++) {
      if (preview.options[i].recommended) return preview.options[i].frequency;
    }
    return preview.options[0].frequency;
  }

  /**
   * The option with the most payments (biweekly where offered), which gives
   * the smallest per-night teaser. No other cadence produces a lower number,
   * which is what keeps "or $X/night over time" truthful.
   */
  function spreadOption(preview) {
    var spread = optionByFrequency(preview, "biweekly");
    if (spread) return spread;
    var best = preview.options[0];
    for (var i = 1; i < preview.options.length; i++) {
      if (preview.options[i].numPayments > best.numPayments) best = preview.options[i];
    }
    return best;
  }

  /**
   * Display currency: the trigger's own, then the listed rooms' (the
   * dataLayer), then config, then the sniffed hint. null when none of them
   * knows: money() then renders a plain number rather than guessing.
   */
  function cur(t) {
    if (t && t.currency) return t.currency;
    var items = state.items || [];
    for (var i = 0; i < items.length; i++) if (items[i].currency) return items[i].currency;
    return CONFIG.currencyFallback || currencyHint || null;
  }

  /**
   * A rooms teaser is confirmed only for the rate the plan was chosen on. The
   * checkout row is confirmed by any plan for this stay, including one chosen
   * on the rooms page, since checkout is that stay's single booking.
   */
  function isConfirmedTrigger(t) {
    if (!state.planChoice || !t) return false;
    return t.kind === "checkout" ? true : state.planChoice.cardKey === t.key;
  }

  function confirmedOption(t) {
    if (!isConfirmedTrigger(t)) return null;
    return optionByFrequency(t.preview, state.planChoice.frequency);
  }

  // =========================================================================
  // TRIGGERS — one per Uplift wrapper, inserted as its next sibling
  // =========================================================================

  /**
   * The element the teaser goes directly after.
   *
   * Finds the innermost element in the rate's price area whose text holds
   * "Excluding taxes and fees", then climbs while that phrase is still the LAST
   * text in the parent. The result is the outermost box that ends with the
   * phrase, so inserting after it lands immediately below the line in reading
   * order, whether "Per Night" and "Excluding..." are siblings or share a
   * wrapper, and never below something that follows the line, like Cash
   * Rewards or Book Now. Uplift and our own teaser are ignored in the text
   * (cardText skips both), so neither can hold the climb back.
   *
   * Falls back to the Uplift wrapper, the previous spot, when the phrase is
   * not in the price area.
   */
  function placementAnchor(uplift) {
    var container = closestSafe(uplift, CONFIG.cards.priceContainerSelector) || uplift.parentElement;
    if (!container) return uplift;
    var re = CONFIG.cards.placeAfterRe;
    var hits = [].slice.call(container.querySelectorAll("*")).filter(function (el) {
      return !closestSafe(el, "[" + BADGE_ATTR + "]") && !closestSafe(el, CONFIG.cards.upliftSelector) && re.test(norm(cardText(el, false)));
    });
    var innermost = hits.filter(function (el) {
      for (var i = 0; i < hits.length; i++) if (hits[i] !== el && el.contains(hits[i])) return false;
      return true;
    });
    var line = innermost[innermost.length - 1];
    if (!line) return uplift;
    var endsWith = new RegExp("(" + re.source + ")[\\s.,;:]*$", re.flags.replace("g", ""));
    var anchor = line;
    while (anchor.parentElement && anchor.parentElement !== container && endsWith.test(norm(cardText(anchor.parentElement, false)))) {
      anchor = anchor.parentElement;
    }
    return anchor;
  }

  /** Puts the host directly after its anchor, moving it if the page shifted. */
  function placeHost(t) {
    var anchor = placementAnchor(t.upliftEl);
    t.anchorEl = anchor;
    t.placedBy = anchor === t.upliftEl ? "after Uplift (fallback)" : "after basis lines";
    if (anchor.nextSibling !== t.hostEl && anchor.parentNode) anchor.parentNode.insertBefore(t.hostEl, anchor.nextSibling);
  }

  function makeHost(uplift) {
    var host = document.createElement("div");
    host.setAttribute(BADGE_ATTR, "");
    // Full-width block in normal flow, so it reads as the line under Uplift
    // even when the price area is a flex row. Never absolutely positioned.
    host.style.display = "none";
    host.style.width = "100%";
    host.style.flexBasis = "100%";
    host.style.marginTop = CONFIG.cards.marginTopPx + "px";
    var root = host.attachShadow({ mode: "open" });
    // Parked after Uplift; placeHost moves it to its anchor in the same sync.
    uplift.parentNode.insertBefore(host, uplift.nextSibling);
    return { host: host, root: root };
  }

  function computeTrigger(t) {
    var stay = state.stay;
    var dom = domPrice(t.upliftEl, t.unitEl);
    var nights = stay && stay.nights;
    var roomEl = closestSafe(t.unitEl, CONFIG.cards.roomSelector);
    var roomName = firstText(roomEl, CONFIG.cards.roomNameSelector);
    var rateName = firstText(t.unitEl, CONFIG.cards.rateNameSelector);
    var item = null;
    if (roomName && state.items.length) {
      var m = matchItemByNames(roomName, rateName, state.items, dom);
      item = m.item;
      t.matchedBy = m.how;
    } else if (state.items.length) {
      item = matchItem(normKey(cardText(t.unitEl, false)), state.items, dom, nights);
      t.matchedBy = item ? "text fallback (room name selector missed)" : "no match";
    } else {
      t.matchedBy = "no dataLayer items";
    }
    t.dom = dom;
    t.item = item;
    t.name = roomName || (item && item.name) || roomHeading(t.unitEl);
    t.variant = rateName || (item ? item.variant : null);
    t.currency = (item && item.currency) || null;
    t.excluded = !!(CONFIG.cards.excludeRatePattern && CONFIG.cards.excludeRatePattern.test((t.name || "") + " " + (t.variant || "")));
    t.amounts = resolveAmounts(item, dom, nights);
    t.key = normKey((t.name || "") + "|" + (t.variant || "") + "|" + (t.amounts ? t.amounts.nightlyCents : ""));
    t.preview =
      t.amounts && stay && stay.checkin && !t.excluded
        ? previewEligibility(startOfToday(), stay.checkin, t.amounts.stayCents, RULES)
        : null;
  }

  function teaserLine(t) {
    if (!t.preview || !t.preview.eligible || !t.preview.options.length || !t.amounts) return null;
    var spread = spreadOption(t.preview);
    return "or " + money(Math.round(t.amounts.nightlyCents / spread.numPayments), cur(t)) + "/night over time";
  }

  function renderTrigger(t) {
    if (t.kind === "checkout") return renderCheckoutRow(t);
    var cOpt = confirmedOption(t);
    var line = cOpt ? null : teaserLine(t);
    // Line up with Uplift, whatever its price area does. :host{all:initial}
    // cuts inheritance, so the alignment is read off the wrapper and restated.
    var align = "left";
    try {
      align = getComputedStyle(t.anchorEl || t.upliftEl).textAlign || "left";
    } catch (e) {
      align = "left";
    }
    var tone = TEASER_TONES[teaserTone(t.hostEl.parentElement || t.upliftEl)];
    var sig = [state.theme && state.theme.font, cOpt ? cOpt.frequency + cOpt.numPayments + cOpt.perPaymentAmountCents : "", line, cur(t), align, tone.text].join("|");
    if (sig === t.sig && t.root.childNodes.length) return;
    t.sig = sig;

    t.root.innerHTML = "";
    if (!cOpt && !line) {
      // Nothing worth showing: stay invisible rather than explain ourselves.
      t.hostEl.style.display = "none";
      return;
    }
    t.root.appendChild(
      h("style", {
        text:
          triggerCss(state.theme.font) +
          ".trig{text-align:" + align + ";color:" + tone.text + "}" +
          ".sub{color:" + tone.sub + "}",
      })
    );
    var kids = cOpt
      ? [
          h("span", { class: "tick", text: "✓" }),
          h("span", { text: "Plan selected" }),
          h("span", { class: "sep", text: "·" }),
          h("span", {
            class: "amt",
            text: cOpt.numPayments + (cOpt.numPayments === 1 ? " payment of " : " payments of ") + money(cOpt.perPaymentAmountCents, cur(t)),
          }),
        ]
      : [h("span", { class: "amt", text: line }), h("span", { class: "sub", text: CONFIG.copy.basisNote + " · No credit check" })];
    t.root.appendChild(
      h(
        "button",
        {
          class: "trig",
          type: "button",
          "aria-haspopup": "dialog",
          onClick: function (ev) {
            ev.preventDefault();
            ev.stopPropagation(); // the room card may itself be clickable
            openModal(t.id);
          },
        },
        kids
      )
    );
    t.hostEl.style.display = "block";
  }

  function renderAllTriggers() {
    state.triggers.forEach(function (t) {
      t.sig = null;
      renderTrigger(t);
    });
  }

  // =========================================================================
  // CHECKOUT — steps 2 to 4
  //
  // Step 2: the Bliss row is a CLONE of SynXis's own FlexPay row
  //   (cloneNode(true)), inserted directly after it. Same markup, same
  //   classes, same stylesheet, so its height, padding, radio, gap, label font
  //   and divider are FlexPay's by construction rather than by measurement.
  //   In the clone, the FlexPay wording becomes "Pay in installments before
  //   your stay", FlexPay's logo is hidden in place, and the Bliss wordmark is
  //   absolutely positioned where that logo sits (see makeMark), at
  //   CONFIG.checkout.wordmarkSizePx.
  // Step 3: clicking the clone opens the plan-picker modal on the checkout total.
  // Step 4: "Select this plan" closes the modal and the plan summary is added
  //   inside the clone, below the label.
  //
  // ISOLATION. The clone must never act as part of SynXis's form:
  //   - Every id, name, for, value, form and data-* attribute is stripped from
  //     the clone and everything in it, BEFORE it is inserted (so a Stimulus
  //     controller never connects to it). An unnamed radio is its own group
  //     and is never submitted, so it cannot uncheck their radios or add a
  //     field to their form. Inline on* handlers, href and id references
  //     (aria-labelledby and friends) go too.
  //   - cloneNode never copies addEventListener handlers, so FlexPay's own
  //     click handling does not come with it.
  //   - Our listeners on the clone stop click, change, input, pointer and key
  //     events from bubbling into the payment box, so a delegated handler of
  //     theirs never sees a click on our row. (Their capture-phase listeners
  //     on ancestors still run first; nothing in a page script can prevent
  //     that.)
  // Nothing of theirs is clicked, changed or read for its value: not the
  // radios, not the card fields, not the submit button. The card row stays
  // exactly as SynXis renders it, because that card is what each payment is
  // charged to.
  //
  // Checkout is detected by the "Credit/Debit Card" label. On checkout the
  // rooms teasers are never created, so Price Details carries no Bliss
  // element; the cloned row is the only one.
  // =========================================================================

  var RADIO_SEL = 'input[type="radio"], [role="radio"]';

  function hasBox(el) {
    try {
      var r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    } catch (e) {
      return false;
    }
  }

  function hasRadio(el) {
    return el.matches(RADIO_SEL) || !!el.querySelector(RADIO_SEL);
  }

  function ancestors(el) {
    var out = [];
    for (var n = el; n; n = n.parentElement) out.push(n);
    return out;
  }

  function lowestCommonAncestor(a, b) {
    var chain = ancestors(a);
    for (var n = b; n; n = n.parentElement) if (chain.indexOf(n) !== -1) return n;
    return null;
  }

  /** The child of `container` that holds `el`: that option's row. */
  function rowIn(container, el) {
    var n = el;
    while (n && n.parentElement !== container) n = n.parentElement;
    return n;
  }

  /**
   * The payment options, found by their labels rather than their radios.
   *
   * The rows are the children of the lowest element holding both the
   * "Credit/Debit Card" label and the "Pay monthly from" label: the level at
   * which the two options are siblings. Radios are deliberately not used to
   * find rows, because a styled radio is often two radio-like elements (a
   * hidden input plus a role="radio" visual), which made "the largest
   * ancestor holding one radio" stop far inside the row.
   *
   * "Pay monthly from" can appear more than once: FlexPay also shows teasers,
   * and one INSIDE the Credit/Debit Card row once won as "nearest", which made
   * part of the card row the "FlexPay row" and put the wordmark on the card
   * brand icons. So an occurrence only counts if it is a payment OPTION: at
   * the level where it and the card label split, both branches carry their
   * own radio. A teaser inside the card row fails that (its branch has no
   * radio). Among the occurrences that pass, the nearest wins.
   */
  function findCheckout() {
    var cardLabel = innermostMatching(document.body, CONFIG.checkout.cardRowRe, 80).filter(hasBox)[0] || null;
    if (!cardLabel) return null;
    var best = null;
    var bestDepth = -1;
    // Not filtered to laid-out elements, so a FlexPay row we hid is still found.
    innermostMatching(document.body, CONFIG.checkout.flexPayRowRe, 200).forEach(function (el) {
      var c = lowestCommonAncestor(cardLabel, el);
      if (!c || c === el) return;
      var row = rowIn(c, el);
      var cardRow = rowIn(c, cardLabel);
      if (!row || !cardRow || row === cardRow) return;
      if (!hasRadio(row) || !hasRadio(cardRow)) return;
      var depth = ancestors(c).length;
      if (depth > bestDepth) {
        best = { label: el, container: c };
        bestDepth = depth;
      }
    });
    var card = { label: cardLabel, row: best ? rowIn(best.container, cardLabel) : cardLabel.parentElement };
    if (!best) return { card: card, flex: null, container: null };
    var flexRow = rowIn(best.container, best.label);
    return {
      card: card,
      flex: { label: best.label, row: flexRow, radios: [].slice.call(flexRow.querySelectorAll(RADIO_SEL)) },
      container: best.container,
    };
  }

  function innermostMatching(scope, re, maxLen) {
    var hits = [].slice.call(scope.querySelectorAll("*")).filter(function (el) {
      if ((el.textContent || "").length > 200) return false;
      if (closestSafe(el, "[" + BADGE_ATTR + "]")) return false;
      var t = norm(cardText(el, true));
      return t && t.length <= maxLen && re.test(t);
    });
    return hits.filter(function (el) {
      for (var i = 0; i < hits.length; i++) if (hits[i] !== el && el.contains(hits[i])) return false;
      return true;
    });
  }

  /**
   * The amount belonging to a Price Details label: after the label phrase in
   * its own text, else in the next few siblings, else after it in a parent's
   * text. Price Details splits "Total" and "$1,113.84" across elements as
   * often as not, which is why all three are tried.
   */
  function amountAfterLabel(el, re) {
    var own = norm(cardText(el, true));
    var m0 = re.exec(own);
    var m = findPrice(m0 ? own.slice(m0.index + m0[0].length) : own);
    if (m) return { cents: parseMoneyTextToCents(m.text), text: m.text };
    var buf = "";
    var sib = el.nextElementSibling;
    for (var i = 0; sib && i < 4; i++, sib = sib.nextElementSibling) {
      buf += " " + cardText(sib, true);
      m = findPrice(norm(buf));
      if (m) return { cents: parseMoneyTextToCents(m.text), text: m.text };
    }
    var node = el;
    for (var d = 0; d < 3; d++) {
      var p = node.parentElement;
      if (!p) break;
      var t = norm(cardText(p, true));
      var at = t.indexOf(own);
      if (at !== -1) {
        m = findPrice(t.slice(at + own.length));
        if (m) return { cents: parseMoneyTextToCents(m.text), text: m.text };
      }
      node = p;
    }
    return null;
  }

  function labeledAmounts(re) {
    return innermostMatching(document.body, re, CONFIG.checkout.labelMaxLength)
      .filter(hasBox)
      .map(function (el) {
        var a = amountAfterLabel(el, re);
        return a ? { label: norm(cardText(el, true)).slice(0, 60), cents: a.cents, text: a.text } : null;
      })
      .filter(function (x) {
        return x && x.cents != null && x.cents > 0;
      });
  }

  function rawSavedPlan() {
    try {
      var raw = sessionStorage.getItem(CONFIG.storageKey);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  /**
   * The checkout total and what it is. The LARGEST "Total" on the page is the
   * stay total (a per-night "Total" line is always smaller). Its basis is
   * settled from the other Price Details lines, never assumed:
   *   total = subtotal + taxes   tax-inclusive
   *   total = subtotal           pre-tax
   *   anything else              unconfirmed, and said so
   * Falls back to the stay total saved from the rooms page (pre-tax) when no
   * total is found, and says that too.
   */
  function readCheckoutTotal() {
    var totals = labeledAmounts(CONFIG.checkout.totalLabelRe);
    var total = null;
    totals.forEach(function (x) {
      if (!total || x.cents > total.cents) total = x;
    });
    var subs = labeledAmounts(CONFIG.checkout.subtotalLabelRe);
    var sub = subs[0] || null;
    var taxes = labeledAmounts(CONFIG.checkout.taxLabelRe);
    var taxCents = taxes.reduce(function (s, x) {
      return s + x.cents;
    }, 0);

    if (!total) {
      var saved = rawSavedPlan();
      if (saved && saved.stayAmountCents) {
        return {
          cents: saved.stayAmountCents,
          label: null,
          text: money(saved.stayAmountCents, saved.currency),
          source: "saved rooms-page stay total (no checkout total found)",
          basis: "pre-tax",
          why: "rooms-page prices are per night and pre-tax",
          note: CONFIG.copy.basisNote,
          subtotal: null,
          taxes: null,
        };
      }
      return null;
    }

    var basis;
    var why;
    if (taxCents > 0 && sub && near(total.cents, sub.cents + taxCents)) {
      basis = "tax-inclusive";
      why = '"' + total.label + '" = "' + sub.label + '" + taxes (' + money(taxCents) + ")";
    } else if (taxCents > 0 && sub && near(total.cents, sub.cents)) {
      basis = "pre-tax";
      why = '"' + total.label + '" equals "' + sub.label + '", taxes (' + money(taxCents) + ") listed separately";
    } else if (!taxCents && sub && near(total.cents, sub.cents)) {
      basis = "pre-tax";
      why = "equals the subtotal and no taxes line was found";
    } else {
      basis = "unconfirmed";
      why = taxCents ? "a taxes line exists but no subtotal adds up to the total" : "no taxes or subtotal line found to check against";
    }
    return {
      cents: total.cents,
      label: total.label,
      text: total.text,
      source: "checkout Price Details",
      basis: basis,
      why: why,
      note: basis === "tax-inclusive" ? "Taxes included" : basis === "pre-tax" ? CONFIG.copy.basisNote : "",
      subtotal: sub ? sub.text : null,
      taxes: taxCents ? money(taxCents) : null,
    };
  }

  // -------------------------------------------------------------------------
  // THE CLONE
  // -------------------------------------------------------------------------

  /** Attributes that would tie the clone to their form, their radio group or their scripts. */
  var STRIP_ATTRS = [
    "id", "name", "for", "value", "form", "href", "action", "formaction", "checked", "required", "autofocus",
    "aria-labelledby", "aria-describedby", "aria-controls", "aria-owns", "aria-activedescendant", "aria-details",
  ];

  function shouldStrip(attrName) {
    var n = attrName.toLowerCase();
    return STRIP_ATTRS.indexOf(n) !== -1 || n.indexOf("data-") === 0 || /^on[a-z]+$/.test(n);
  }

  function sanitizeClone(root) {
    [root].concat([].slice.call(root.querySelectorAll("*"))).forEach(function (el) {
      [].slice.call(el.attributes).forEach(function (a) {
        if (shouldStrip(a.name)) el.removeAttribute(a.name);
      });
      if (el.tagName === "INPUT") {
        el.checked = false;
        el.defaultChecked = false;
      }
    });
  }

  /** What is left in the clone that would tie it to their page. Should be []. */
  function leftoverAttrs(root) {
    var out = [];
    [root].concat([].slice.call(root.querySelectorAll("*"))).forEach(function (el) {
      [].slice.call(el.attributes).forEach(function (a) {
        if (a.name !== BADGE_ATTR && shouldStrip(a.name)) out.push(el.tagName.toLowerCase() + "[" + a.name + "]");
      });
    });
    return out;
  }

  function pathTo(root, el) {
    var path = [];
    for (var n = el; n && n !== root; n = n.parentElement) {
      path.unshift([].indexOf.call(n.parentElement.children, n));
    }
    return path;
  }

  function resolvePath(root, path) {
    var n = root;
    for (var i = 0; n && i < path.length; i++) n = n.children[path[i]];
    return n || null;
  }

  function precedesOrContains(a, b) {
    var pos = a.compareDocumentPosition(b);
    return !!(pos & Node.DOCUMENT_POSITION_FOLLOWING || pos & Node.DOCUMENT_POSITION_CONTAINED_BY);
  }

  var FLEXPAY_NAME_RE = /flex\s*-?\s*pay/i;
  var CARD_BRAND_RE = /visa|master\s*-?\s*card|amex|american\s*express|discover|diners|jcb|union\s*pay|bank\s*of\s*america|\bbofa\b|card[-_\s]?(brand|icon|type)|\bcc[-_]/i;

  /** Everything that names an element: src, alt, title, aria-label, class, an svg's <title>. */
  function describeEl(el) {
    var svgTitle = el.tagName.toLowerCase() === "svg" && el.querySelector("title") ? el.querySelector("title").textContent : "";
    var cls = el.getAttribute("class") || "";
    return [el.getAttribute("src"), el.getAttribute("srcset"), el.getAttribute("alt"), el.getAttribute("title"), el.getAttribute("aria-label"), cls, svgTitle]
      .filter(Boolean)
      .join(" ");
  }

  function isImageLike(el) {
    return /^(img|svg|picture)$/i.test(el.tagName) || !!el.querySelector("img, svg, picture");
  }

  /**
   * FlexPay's logo, searched ONLY inside the FlexPay option row, and only
   * after its label text (so a radio drawn as an svg is never taken).
   *
   * Preference, first match wins:
   *   1. an element NAMED FlexPay (src, alt, title, aria-label, class or svg
   *      title) that is, or holds, an image
   *   2. an element whose text is exactly "FlexPay"
   *   3. any other element named FlexPay
   *   4. last resort, a generic image or "logo" element that names no card
   *      brand (Visa, Mastercard, Bank of America and so on)
   * Card brand icons are never candidates. The outermost of the winning pool
   * is taken, so a logo wrapper is replaced whole rather than just its <img>.
   * Returns { el, why } or null.
   */
  function findLogo(row, label) {
    var cands = [].slice
      .call(row.querySelectorAll('img, svg, picture, [class*="logo" i], [class*="flexpay" i], [alt], [aria-label], [title]'))
      .concat(innermostMatching(row, /^\s*flex\s*-?\s*pay\s*$/i, 40))
      .filter(function (el) {
        if (el === label || el.contains(label) || hasRadio(el)) return false;
        if (CARD_BRAND_RE.test(describeEl(el))) return false;
        return precedesOrContains(label, el);
      });
    var named = cands.filter(function (el) {
      return FLEXPAY_NAME_RE.test(describeEl(el));
    });
    var pools = [
      { why: "named FlexPay, image", els: named.filter(isImageLike) },
      { why: 'text "FlexPay"', els: cands.filter(function (el) { return /^\s*flex\s*-?\s*pay\s*$/i.test(el.textContent || ""); }) },
      { why: "named FlexPay", els: named },
      { why: "generic image, no FlexPay-named element found", els: cands.filter(function (el) { return /^(img|svg|picture)$/i.test(el.tagName) || /logo/i.test(el.getAttribute("class") || ""); }) },
    ];
    var pool = null;
    for (var p = 0; p < pools.length && !pool; p++) if (pools[p].els.length) pool = pools[p];
    if (!pool) return null;
    var outer = pool.els.filter(function (el) {
      for (var i = 0; i < pool.els.length; i++) if (pool.els[i] !== el && pool.els[i].contains(el)) return false;
      return true;
    });
    // Rightmost when laid out; otherwise the last in document order.
    var best = null;
    var bestRight = -Infinity;
    outer.forEach(function (el) {
      var r = el.getBoundingClientRect();
      var right = r.width > 0 ? r.right : -1;
      if (!best || right >= bestRight) {
        best = el;
        bestRight = right;
      }
    });
    return best ? { el: best, why: pool.why } : null;
  }

  /**
   * Replaces the FlexPay wording in the clone's label with ours, in place.
   *
   * The wording is often split across nodes ("Pay monthly from " + <span>$85
   * </span> + " per month"), so the label's text nodes are treated as one
   * string: the FlexPay phrase is located in it and swapped for our label,
   * text before or after the phrase is left alone, and any element emptied by
   * the swap (that "$85" span) is removed. Elements that never had text, like
   * a styled radio's indicator, are never touched. The logo is skipped; it is
   * replaced separately. Returns the text node now holding our label, or null.
   */
  function swapLabel(labelEl, logoEl) {
    var nodes = [];
    var walker = document.createTreeWalker(labelEl, NodeFilter.SHOW_TEXT);
    for (var n = walker.nextNode(); n; n = walker.nextNode()) {
      if (logoEl && logoEl.contains(n)) continue;
      nodes.push(n);
    }
    var joined = "";
    var starts = [];
    nodes.forEach(function (tn) {
      starts.push(joined.length);
      joined += tn.nodeValue;
    });
    var m = CONFIG.checkout.flexPayPhraseRe.exec(joined);
    var s = m ? m.index : joined.search(/\S/);
    var e = m ? m.index + m[0].length : joined.length;
    if (s < 0) return null;
    var placed = null;
    var emptied = [];
    nodes.forEach(function (tn, i) {
      var a = starts[i];
      var b = a + tn.nodeValue.length;
      if (b <= s || a >= e) return;
      var before = s > a ? tn.nodeValue.slice(0, s - a) : "";
      var after = e < b ? tn.nodeValue.slice(e - a) : "";
      tn.nodeValue = before + (placed ? "" : CONFIG.checkout.copy.rowLabel) + after;
      if (!placed) placed = tn;
      else if (!tn.nodeValue) emptied.push(tn);
    });
    emptied.forEach(function (tn) {
      var p = tn.parentElement;
      tn.remove();
      while (p && p !== labelEl && !p.childNodes.length) {
        var up = p.parentElement;
        p.remove();
        p = up;
      }
    });
    return placed;
  }

  /**
   * The rendered box of what a logo actually shows: an image's own box, or
   * for text, the glyphs (so a text logo's padding is not counted).
   */
  function visibleRect(el) {
    if (/^(img|svg)$/i.test(el.tagName)) return el.getBoundingClientRect();
    var range = document.createRange();
    range.selectNodeContents(el);
    return range.getBoundingClientRect();
  }

  /**
   * The Bliss wordmark alone, as the logo is drawn in the app: Georgia Bold,
   * amethyst, or the lighter amethyst tint on a dark background, at exactly
   * CONFIG.checkout.wordmarkSizePx.
   *
   * ABSOLUTELY positioned inside our cloned row (which is made position:
   * relative), at the spot FlexPay's logo occupies in the FlexPay row:
   * `right` is the logo's distance from that row's right edge and `top` is
   * the logo's centre, with translateY(-50%) centring the wordmark on it.
   * Both are measured once, from the FlexPay row, in buildClone. Nothing
   * about the label is changed to make room, so choosing a plan (which adds
   * lines BELOW the label) cannot move the wordmark off the label's line.
   *
   * Every property !important, so no rule of the page's can resize, restyle
   * or reposition it.
   */
  function makeMark(tone, place) {
    var mark = document.createElement("span");
    mark.textContent = "Bliss";
    setImportant(mark, {
      position: "absolute",
      right: place.right,
      top: place.top,
      left: "auto",
      bottom: "auto",
      transform: "translateY(-50%)",
      margin: "0",
      padding: "0",
      display: "block",
      "white-space": "nowrap",
      "font-family": "Georgia, serif",
      "font-weight": "700",
      "font-style": "normal",
      "letter-spacing": "normal",
      "text-transform": "none",
      "line-height": "1",
      "font-size": CONFIG.checkout.wordmarkSizePx + "px",
      color: tone === TEASER_TONES.dark ? BLISS_COLORS.tint40 : BLISS_COLORS.amethyst,
    });
    return mark;
  }

  function px(v) {
    var n = parseFloat(v);
    return isFinite(n) ? n : 0;
  }

  function setImportant(el, props) {
    Object.keys(props).forEach(function (k) {
      el.style.setProperty(k, props[k], "important");
    });
  }

  var ISOLATED_EVENTS = ["change", "input", "mousedown", "mouseup", "pointerdown", "pointerup", "keyup", "dblclick"];

  function buildClone(t, co) {
    var src = co.flex.row;
    var tone = TEASER_TONES[teaserTone(src)];
    var found = findLogo(src, co.flex.label);
    var logo = found ? found.el : null;
    var labelPath = pathTo(src, co.flex.label);
    var logoPath = logo ? pathTo(src, logo) : null;

    var clone = src.cloneNode(true);
    var cLabel = resolvePath(clone, labelPath);
    var cLogo = logoPath ? resolvePath(clone, logoPath) : null;
    // Before insertion, so nothing on their side ever sees the clone with their
    // ids, names or data-* controller bindings on it.
    sanitizeClone(clone);
    clone.setAttribute(BADGE_ATTR, "");
    // Cloned from a row we hid: the clone itself must show.
    if (src.hasAttribute(HIDDEN_ATTR)) {
      clone.style.removeProperty("display");
      var prev = src.getAttribute(HIDDEN_ATTR);
      if (prev) clone.style.setProperty("display", prev);
    }

    var placedText = cLabel ? swapLabel(cLabel, cLogo) : null;
    var labelSwapped = !!placedText;
    // The summary stacks under the label text, so it goes in the element that
    // holds that text. When the text is a bare node sharing a (flex) row with
    // the radio or the logo, it is wrapped in a span first: appending to the
    // row itself would put the summary beside the logo instead of below.
    var textHome = placedText ? placedText.parentElement : cLabel;
    if (placedText && (textHome.querySelector(RADIO_SEL) || (cLogo && textHome.contains(cLogo)) || textHome === clone)) {
      var wrap = document.createElement("span");
      placedText.parentNode.insertBefore(wrap, placedText);
      wrap.appendChild(placedText);
      textHome = wrap;
    }
    // `top` is measured ONCE, on the real FlexPay row: its logo's centre,
    // relative to the row's padding box (which is what an absolute child of
    // our clone, the same element, is positioned against). With no logo found,
    // the row's vertical middle. `right` is not measured: it is always
    // CONFIG.checkout.wordmarkRightPx.
    var srcRect = src.getBoundingClientRect();
    var srcCs = getComputedStyle(src);
    var logoBox = logo && hasBox(logo) ? visibleRect(logo) : null;
    var place = {
      right: CONFIG.checkout.wordmarkRightPx + "px",
      top: logoBox
        ? Math.round((logoBox.top + logoBox.height / 2 - srcRect.top - px(srcCs.borderTopWidth)) * 10) / 10 + "px"
        : "50%",
    };

    // FlexPay's logo stays in the clone, invisible, so the label keeps exactly
    // the layout it had in the FlexPay row.
    var logoReplaced = false;
    if (cLogo) {
      setImportant(cLogo, { visibility: "hidden" });
      cLogo.setAttribute("aria-hidden", "true");
      logoReplaced = true;
    }

    // Our row is the wordmark's positioning box.
    setImportant(clone, { position: "relative" });
    var markEl = makeMark(tone, place);
    clone.appendChild(markEl);

    // The plan summary stacks under the label text, inside the element that
    // holds it. The label itself is not restyled.
    var summary = document.createElement("span");
    // Pinned to the label's own size: as the last span in the label, it is
    // exactly what a "label span:last-child" rule of theirs would restyle.
    setImportant(summary, { display: "block", "font-size": "inherit", "line-height": "inherit" });
    (textHome || clone).appendChild(summary);

    function open(ev) {
      ev.preventDefault();
      ev.stopPropagation();
      openModal(t.id);
    }
    clone.addEventListener("click", open);
    clone.addEventListener("keydown", function (ev) {
      ev.stopPropagation();
      if (ev.key === "Enter" || ev.key === " ") open(ev);
    });
    ISOLATED_EVENTS.forEach(function (type) {
      clone.addEventListener(type, function (ev) {
        ev.stopPropagation();
      });
    });

    t.hostEl = clone;
    t.sourceRow = src;
    t.summaryEl = summary;
    t.markEl = markEl;
    t.cloneRadios = [].slice.call(clone.querySelectorAll(RADIO_SEL));
    t.tone = tone;
    t.cloneDisplay = clone.style.getPropertyValue("display") || "";
    t.build = {
      labelSwapped: labelSwapped,
      logoReplaced: logoReplaced,
      flexRow: src.tagName.toLowerCase() + (src.getAttribute("class") ? "." + src.getAttribute("class").trim().split(/\s+/).join(".") : ""),
      logo: logo ? { el: logo.tagName.toLowerCase(), named: describeEl(logo).slice(0, 120), chosenAs: found.why } : null,
      radios: t.cloneRadios.length,
      leftoverAttrs: leftoverAttrs(clone),
      wordmark: { sizePx: CONFIG.checkout.wordmarkSizePx, right: place.right, top: place.top, measuredFrom: logoBox ? "FlexPay logo" : "row padding (no logo found)" },
    };
    t.sig = null;
    if (!labelSwapped) console.warn("[bliss] checkout: FlexPay wording not found in the cloned row, so its label was not replaced.");
    if (!logo) console.warn("[bliss] checkout: no FlexPay logo found in the row; the wordmark sits at the row's right padding instead.");
  }

  var lastCheckoutLogKey = null;

  function renderCheckoutRow(t) {
    if (!t.hostEl) return;
    var eligible = !!(t.preview && t.preview.eligible && t.preview.options.length);
    if (!eligible) {
      t.hostEl.style.setProperty("display", "none");
      t.sig = null;
      return;
    }
    var cOpt = confirmedOption(t);
    var selected = !!cOpt || !!(state.modal && state.modal.triggerId === t.id);
    var currency = cur(t);
    var sig = JSON.stringify([selected, cOpt ? [cOpt.frequency, cOpt.numPayments, cOpt.perPaymentAmountCents] : null, currency]);
    if (sig === t.sig) return;
    t.sig = sig;

    t.cloneRadios.forEach(function (r) {
      if (r.tagName === "INPUT") r.checked = selected;
      if (r.getAttribute("role") === "radio" || r.hasAttribute("aria-checked")) r.setAttribute("aria-checked", selected ? "true" : "false");
    });

    var s = t.summaryEl;
    while (s.firstChild) s.removeChild(s.firstChild);
    if (cOpt) {
      var line = document.createElement("span");
      setImportant(line, { display: "block", "margin-top": "4px", "font-weight": "600", "font-size": "inherit", "line-height": "inherit" });
      line.textContent =
        planLabel(cOpt.frequency) + " · " + cOpt.numPayments +
        (cOpt.numPayments === 1 ? " payment of " : " payments of ") + money(cOpt.perPaymentAmountCents, currency);
      var note = document.createElement("span");
      setImportant(note, { display: "block", "margin-top": "2px", "font-size": ".85em", "font-weight": "400", "line-height": "inherit", color: t.tone.sub });
      note.appendChild(document.createTextNode(CONFIG.checkout.copy.cardNote + " "));
      var change = document.createElement("button");
      change.type = "button";
      change.textContent = "Change plan";
      change.style.cssText =
        "background:none;border:0;padding:0;margin:0;font:inherit;color:inherit;text-decoration:underline;cursor:pointer";
      note.appendChild(change);
      s.appendChild(line);
      s.appendChild(note);
    }

    if (t.cloneDisplay) t.hostEl.style.setProperty("display", t.cloneDisplay);
    else t.hostEl.style.removeProperty("display");
    if (!cOpt) checkCloneMatches(t);
  }

  /**
   * Self-check: the unselected clone should measure exactly like the FlexPay
   * row. The one known way it cannot is CSS keyed to the ids we strip (a
   * "#flexpay-option" rule, say), which the clone no longer matches. Reported
   * in probe().checkout.clone.matchesFlexPay and warned once, rather than
   * shipped as a quietly different row.
   */
  function checkCloneMatches(t) {
    var src = t.co && t.co.flex && t.co.flex.row;
    if (!src || !hasBox(src) || !hasBox(t.hostEl)) return;
    var a = src.getBoundingClientRect();
    var b = t.hostEl.getBoundingClientRect();
    var ca = getComputedStyle(src);
    var cb = getComputedStyle(t.hostEl);
    var diffs = [];
    if (Math.round(a.height) !== Math.round(b.height)) diffs.push("height " + Math.round(a.height) + " vs " + Math.round(b.height));
    ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "borderTopWidth", "fontSize"].forEach(function (p) {
      if (ca[p] !== cb[p]) diffs.push(p + " " + ca[p] + " vs " + cb[p]);
    });
    var ra = t.co.flex.radios.filter(hasBox)[0];
    var rb = t.cloneRadios.filter(hasBox)[0];
    if (ra && rb) {
      var x = ra.getBoundingClientRect();
      var y = rb.getBoundingClientRect();
      if (Math.round(x.width) !== Math.round(y.width) || Math.round(x.left - a.left) !== Math.round(y.left - b.left)) {
        diffs.push("radio " + Math.round(x.width) + "px at " + Math.round(x.left - a.left) + " vs " + Math.round(y.width) + "px at " + Math.round(y.left - b.left));
      }
    }
    if (t.build) t.build.matchesFlexPay = diffs.length ? diffs : true;
    if (diffs.length && !t.warnedMismatch) {
      t.warnedMismatch = true;
      console.warn(
        "[bliss] checkout: the Bliss row does not measure like the FlexPay row (" + diffs.join("; ") + "). " +
          "Most likely their CSS targets the FlexPay row by id, which the clone no longer has. " +
          "Send copy(__blissOverlay.paymentBoxHtml()) and the matching CSS rule."
      );
    }
  }

  function checkoutTrigger() {
    for (var i = 0; i < state.triggers.length; i++) if (state.triggers[i].kind === "checkout") return state.triggers[i];
    return null;
  }

  var warnedFlexChecked = false;

  function syncCheckout(co) {
    // The rooms teasers never appear on checkout, Price Details included.
    state.triggers.forEach(function (x) {
      if (x.kind !== "checkout" && x.hostEl && x.hostEl.parentNode) x.hostEl.parentNode.removeChild(x.hostEl);
    });
    var t = checkoutTrigger() || { id: state.nextId++, kind: "checkout", key: "checkout", hostEl: null, sig: null };
    state.triggers = [t];
    t.co = co;

    if (!co.flex) {
      if (t.hostEl && t.hostEl.parentNode) t.hostEl.parentNode.removeChild(t.hostEl);
      t.hostEl = null;
      if (lastCheckoutLogKey !== "no-flex") {
        lastCheckoutLogKey = "no-flex";
        console.warn("[bliss] checkout: no FlexPay row to clone, so the Bliss row is not shown.");
      }
      return;
    }

    // (Re)build when there is no clone yet, it was dropped (a Turbo render),
    // or SynXis replaced the FlexPay row it was cloned from.
    if (!t.hostEl || !t.hostEl.isConnected || t.sourceRow !== co.flex.row) {
      if (t.hostEl && t.hostEl.parentNode) t.hostEl.parentNode.removeChild(t.hostEl);
      buildClone(t, co);
    }

    if (CONFIG.hideFlexPay) {
      hideHostEl(co.flex.row);
      if (!warnedFlexChecked && co.flex.radios.some(function (r) { return r.checked || r.getAttribute("aria-checked") === "true"; })) {
        warnedFlexChecked = true;
        console.warn("[bliss] FlexPay was already selected when its row was hidden. Pick Credit/Debit Card before demoing.");
      }
    }
    if (co.flex.row.nextSibling !== t.hostEl) co.flex.row.parentNode.insertBefore(t.hostEl, co.flex.row.nextSibling);

    var total = readCheckoutTotal();
    t.total = total;
    var nights = state.stay && state.stay.nights;
    t.amounts = total
      ? { source: total.source, basis: total.basis, how: total.why, stayCents: total.cents, nightlyCents: nights ? Math.round(total.cents / nights) : null }
      : null;
    t.basisNote = total ? total.note : "";
    t.name = (state.planChoice && state.planChoice.roomName) || CONFIG.property.name;
    t.variant = state.planChoice ? state.planChoice.rateName : null;
    t.item = null;
    t.currency = (state.planChoice && state.planChoice.currency) || null;
    t.preview =
      t.amounts && state.stay && state.stay.checkin
        ? previewEligibility(startOfToday(), state.stay.checkin, t.amounts.stayCents, RULES)
        : null;

    var key = [total && total.cents, total && total.basis, t.preview && t.preview.reason].join("|");
    if (key !== lastCheckoutLogKey) {
      lastCheckoutLogKey = key;
      if (total) {
        console.info(
          "[bliss] checkout total: " + total.text + (total.label ? ' from "' + total.label + '"' : "") +
            ", " + total.basis.toUpperCase() + " (" + total.why + "). Source: " + total.source + "."
        );
      } else {
        console.warn("[bliss] checkout: no total found in Price Details and no saved plan, so the Bliss row stays hidden.");
      }
      if (t.preview && !t.preview.eligible) {
        console.info("[bliss] checkout: no plan for this stay (" + t.preview.reason + "), so the Bliss row stays hidden.");
      }
    }
    renderTrigger(t);
  }

  /**
   * The payment box's markup, for checking the clone against the real page.
   * Run in the console: copy(__blissOverlay.paymentBoxHtml())
   * value attributes are stripped and our clone is left out.
   */
  function paymentBoxHtml() {
    var co = findCheckout();
    if (!co) return "no payment box found (no Credit/Debit Card label on this page)";
    var box = (co.container || co.card.row.parentElement).cloneNode(true);
    [].slice.call(box.querySelectorAll("[" + BADGE_ATTR + "]")).forEach(function (el) {
      el.remove();
    });
    [box].concat([].slice.call(box.querySelectorAll("[value]"))).forEach(function (el) {
      el.removeAttribute("value");
    });
    return box.outerHTML;
  }

  // =========================================================================
  // MODAL — ported from mews-overlay.js. No Bliss-rate button press, no
  // deposit line (no deposit), no fee line (free trial).
  // =========================================================================

  var modalHostEl = null;
  var modalRoot = null;

  /** Turbo swaps <body> on every visit, so the host is re-checked each open. */
  function ensureModalHost() {
    if (modalHostEl && modalHostEl.isConnected) return;
    modalHostEl = document.createElement("div");
    modalHostEl.id = MODAL_HOST_ID;
    modalHostEl.style.cssText = "position:fixed;top:0;right:0;bottom:0;left:0;z-index:2147483647;display:none";
    modalRoot = modalHostEl.attachShadow({ mode: "open" });
    document.body.appendChild(modalHostEl);
  }

  function triggerById(id) {
    for (var i = 0; i < state.triggers.length; i++) if (state.triggers[i].id === id) return state.triggers[i];
    return null;
  }

  function onKeydown(ev) {
    if (ev.key === "Escape" && state.modal) {
      ev.stopPropagation();
      closeModal();
    }
  }

  function openModal(triggerId) {
    var t = triggerById(triggerId);
    if (!t) return;
    state.modal = {
      triggerId: triggerId,
      selected: isConfirmedTrigger(t) ? state.planChoice.frequency : defaultSelected(t.preview),
      justConfirmed: false,
      scheduleOpen: false,
      termsOpen: false,
    };
    ensureModalHost();
    modalHostEl.style.display = "block";
    document.addEventListener("keydown", onKeydown, true);
    renderModal();
    // The checkout row shows its radio selected while its modal is open.
    if (t.kind === "checkout") {
      t.sig = null;
      renderTrigger(t);
    }
  }

  function closeModal() {
    state.modal = null;
    document.removeEventListener("keydown", onKeydown, true);
    if (modalHostEl) {
      modalHostEl.style.display = "none";
      if (modalRoot) modalRoot.innerHTML = "";
    }
    // Closed without a plan: the checkout row's radio goes back to unselected.
    var ct = checkoutTrigger();
    if (ct) {
      ct.sig = null;
      renderTrigger(ct);
    }
  }

  function clearPlan() {
    state.planChoice = null;
    savePlan();
    renderAllTriggers();
  }

  function planSummary(option, currency) {
    return (
      planLabel(option.frequency) + ", " + option.numPayments +
      (option.numPayments === 1 ? " payment of " : " payments of ") +
      money(option.perPaymentAmountCents, currency) + " through " +
      shortDate(option.dueDates[option.dueDates.length - 1])
    );
  }

  function renderModal() {
    if (!state.modal || !modalRoot) return;
    var t = triggerById(state.modal.triggerId);
    if (!t) {
      closeModal();
      return;
    }
    var preview = t.preview;
    var currency = cur(t);
    var stay = state.stay;
    var isCheckout = t.kind === "checkout";

    modalRoot.innerHTML = "";
    modalRoot.appendChild(h("style", { text: modalCss(state.theme.font) }));

    var head = h("div", { class: "head" }, [
      h("div", {}, [
        h("h2", { text: "Spread this stay over time" }),
        h("p", { text: t.name || CONFIG.property.name }),
      ]),
      h("button", { class: "x", "aria-label": "Close", type: "button", onClick: closeModal, text: "×" }),
    ]);
    var body = h("div", { class: "body" });

    var ctx = [];
    if (stay && stay.checkinIso) ctx.push(shortDate(stay.checkinIso));
    if (stay && stay.nights) ctx.push(stay.nights + (stay.nights === 1 ? " night" : " nights"));
    if (t.amounts) ctx.push(money(t.amounts.stayCents, currency));
    body.appendChild(h("div", { class: "ctx", text: ctx.join(" · ") || "Waiting for dates" }));
    // Checkout states the basis the total was confirmed to have, and nothing
    // when it could not be confirmed, rather than claim one.
    var fine = isCheckout ? t.basisNote : CONFIG.copy.basisNote;
    if (fine) body.appendChild(h("div", { class: "fine", text: fine }));

    if (!preview || !preview.eligible) {
      var reason = preview ? preview.reason : "invalid_input";
      body.appendChild(h("div", { class: "msg", text: REASON_COPY[reason] || REASON_COPY.invalid_input }));
      mountModalCard(head, body);
      return;
    }

    // Confirmed: the modal becomes a receipt.
    var confirmed = confirmedOption(t);
    if (confirmed) {
      var reopened = !state.modal.justConfirmed;
      body.appendChild(h("div", { class: "plan", text: planSummary(confirmed, currency) }));
      body.appendChild(
        h("div", {
          class: "confirmed",
          text: isCheckout
            ? "You selected the " + planLabel(confirmed.frequency) + " plan. Enter your card and complete your booking as usual."
            : reopened
              ? "You selected the " + planLabel(confirmed.frequency) + " plan. Book this room as usual and your plan will be waiting at checkout."
              : "Plan selected. Book this room as usual and your plan will be waiting at checkout.",
        })
      );
      body.appendChild(
        h("button", { class: "cta", type: "button", text: isCheckout ? "Back to checkout" : "Back to booking", onClick: closeModal })
      );
      if (reopened) {
        body.appendChild(
          h("button", {
            class: "textbtn",
            type: "button",
            text: "Cancel plan",
            onClick: function () {
              state.modal.justConfirmed = false;
              clearPlan();
              renderModal();
            },
          })
        );
      }
      mountModalCard(head, body);
      return;
    }

    preview.options.forEach(function (opt) {
      var isSel = state.modal.selected === opt.frequency;
      var title = h("div", { class: "lbl", text: planLabel(opt.frequency) });
      if (opt.recommended) title.appendChild(h("span", { class: "tag", text: "Recommended" }));
      body.appendChild(
        h(
          "button",
          {
            class: "opt",
            type: "button",
            "aria-pressed": isSel ? "true" : "false",
            onClick: function () {
              // Clicking the selected row toggles it off, so a guest can back out.
              state.modal.selected = isSel ? null : opt.frequency;
              renderModal();
            },
          },
          [
            h("div", {}, [
              title,
              h("div", {
                class: "sub",
                text:
                  opt.numPayments + (opt.numPayments === 1 ? " payment" : " payments") +
                  " through " + shortDate(opt.dueDates[opt.dueDates.length - 1]),
              }),
            ]),
            h("div", { class: "amt" }, [
              h("b", { text: money(opt.perPaymentAmountCents, currency) }),
              h("span", { text: "per payment" }),
            ]),
          ]
        )
      );
    });

    var chosen = optionByFrequency(preview, state.modal.selected);
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
              h("span", { class: "v", text: money(last ? chosen.finalPaymentAmountCents : chosen.perPaymentAmountCents, currency) }),
            ])
          );
        });
        body.appendChild(rows);
      }
    }

    if (CONFIG.copy.showPlanTerms) body.appendChild(
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
    if (CONFIG.copy.showPlanTerms && state.modal.termsOpen) {
      var terms = h("div", { class: "terms" });
      PLAN_TERMS_LINES.forEach(function (line) {
        terms.appendChild(h("div", { class: "row", text: line }));
      });
      body.appendChild(terms);
    }

    body.appendChild(
      h("button", {
        class: "cta",
        type: "button",
        text: "Select this plan",
        disabled: chosen ? null : "disabled",
        onClick: function () {
          // Re-resolved at click time; `disabled` is advisory.
          var live = state.modal ? optionByFrequency(t.preview, state.modal.selected) : null;
          if (live) confirmPlan(t, live);
        },
      })
    );
    body.appendChild(
      h("div", {
        class: "note",
        text: isCheckout
          ? "Your card is charged for each payment. Enter it and complete your booking as usual."
          : "Choose your plan, then finish your booking at checkout.",
      })
    );
    mountModalCard(head, body);
  }

  function mountModalCard(head, body) {
    var pwr = h("div", { class: "pwr", text: "Powered by " }, [h("span", { class: "wm", text: "Bliss" })]);
    var card = h("div", { class: "bliss-card", role: "dialog", "aria-modal": "true", tabindex: "-1" }, [head, body, pwr]);
    card.addEventListener("click", function (ev) {
      ev.stopPropagation();
    });
    modalRoot.appendChild(h("div", { class: "scrim", onClick: closeModal }, [card]));
    try {
      card.focus();
    } catch (e) {
      /* ignore */
    }
  }

  /**
   * One plan per stay. The record keeps what the checkout steps will need to
   * show the confirmed-plan block: the cadence, the schedule, the stay and the
   * room, all in integer cents. No fee field: this is a free trial.
   */
  function confirmPlan(t, option) {
    var stay = state.stay;
    var isCheckout = t.kind === "checkout";
    state.planChoice = {
      // Chosen at checkout, the plan keeps the rate it was first chosen on
      // (if any), so the rooms teaser for that rate still reads "Plan selected".
      cardKey: isCheckout && state.planChoice ? state.planChoice.cardKey : t.key,
      chosenOn: isCheckout ? "checkout" : "rooms",
      frequency: option.frequency,
      numPayments: option.numPayments,
      perPaymentAmountCents: option.perPaymentAmountCents,
      finalPaymentAmountCents: option.finalPaymentAmountCents,
      dueDates: option.dueDates.slice(),
      stayAmountCents: t.amounts.stayCents,
      nightlyAmountCents: t.amounts.nightlyCents,
      amountSource: t.amounts.source,
      amountBasis: t.amounts.basis,
      currency: cur(t),
      roomName: t.name || null,
      rateName: t.variant || null,
      itemId: t.item ? t.item.id : null,
      checkin: stay.checkinIso,
      checkout: stay.checkoutIso,
      nights: stay.nights,
      chainId: stay.chainParam || CONFIG.property.chainId,
      hotelId: stay.hotelParam || CONFIG.property.hotelId,
      hotelName: stay.hotelName || CONFIG.property.name,
      selectedAt: new Date().toISOString(),
    };
    savePlan();
    console.log("[bliss] plan selected", state.planChoice);
    state.modal.justConfirmed = true;
    renderAllTriggers();
    // Step 4: at checkout the modal closes and the row carries the plan.
    if (CONFIG.closeModalOnConfirm || isCheckout) closeModal();
    else renderModal();
  }

  // =========================================================================
  // SYNC — idempotent, run on every mutation and every Turbo event
  // =========================================================================

  function sync() {
    state.stay = readStay();
    var r = readItems();
    state.items = r.items;
    state.itemEvents = r.events;

    // Checkout may carry no dates in its URL or dataLayer. The plan saved on
    // the rooms page (or at an earlier checkout render) knows the stay, so its
    // dates stand in, and are reported as the source.
    if (!state.stay.checkin || !state.stay.nights) {
      var saved = rawSavedPlan();
      var ci = saved && parseAnyDate(saved.checkin);
      var cx = saved && parseAnyDate(saved.checkout);
      if (ci && cx && daysBetween(ci, cx) > 0) {
        state.stay.checkin = ci;
        state.stay.checkout = cx;
        state.stay.checkinIso = formatDate(ci);
        state.stay.checkoutIso = formatDate(cx);
        state.stay.nights = daysBetween(ci, cx);
        state.stay.source = "saved plan (no dates on this page)";
      }
    }

    if (!state.planChoice) state.planChoice = loadPlan(state.stay);
    else if (
      state.stay.checkinIso &&
      (state.planChoice.checkin !== state.stay.checkinIso || state.planChoice.checkout !== state.stay.checkoutIso)
    ) {
      // Dates changed under a confirmed plan: it no longer describes this stay.
      console.info("[bliss] stay dates changed, clearing the selected plan");
      state.planChoice = null;
      savePlan();
    }

    var uplifts = upliftEls();
    if (CONFIG.hideUplift) uplifts.forEach(hideHostEl);
    if (!state.theme) state.theme = { font: sampleFont(uplifts[0] ? uplifts[0].parentNode : document.body) };

    var co = findCheckout();
    state.mode = co ? "checkout" : "rooms";
    if (co) syncCheckout(co);
    else syncRooms(uplifts);

    // Sweep: a Turbo visit swaps <body>, and a restored snapshot carries clones
    // of our hosts with no shadow root. Anything not a live trigger's host goes.
    var live = state.triggers.map(function (t) {
      return t.hostEl;
    });
    [].slice.call(document.querySelectorAll("[" + BADGE_ATTR + "]")).forEach(function (el) {
      if (live.indexOf(el) === -1 && el.parentNode) el.parentNode.removeChild(el);
    });

    if (state.modal) {
      if (!triggerById(state.modal.triggerId)) closeModal();
    }
  }

  function syncRooms(uplifts) {
    state.triggers = state.triggers.filter(function (t) {
      // Position is not checked here: placeHost re-seats a live host below.
      var ok = t.kind !== "checkout" && t.hostEl.isConnected && t.upliftEl.isConnected && !!t.hostEl.shadowRoot;
      if (!ok && t.hostEl.parentNode) t.hostEl.parentNode.removeChild(t.hostEl);
      return ok;
    });

    uplifts.forEach(function (u) {
      for (var i = 0; i < state.triggers.length; i++) if (state.triggers[i].upliftEl === u) return;
      if (!u.parentNode) return;
      var made = makeHost(u);
      state.triggers.push({ id: state.nextId++, upliftEl: u, unitEl: unitFor(u), hostEl: made.host, root: made.root, sig: null });
    });

    state.triggers.forEach(function (t) {
      t.unitEl = t.unitEl && t.unitEl.isConnected ? t.unitEl : unitFor(t.upliftEl);
      placeHost(t);
      computeTrigger(t);
      renderTrigger(t);
    });
  }

  var syncQueued = false;

  function requestSync() {
    if (syncQueued) return;
    syncQueued = true;
    var run = function () {
      if (!syncQueued) return;
      syncQueued = false;
      try {
        sync();
      } catch (e) {
        console.error("[bliss] sync failed", e);
      }
    };
    if (typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(run);
    // Backstop: rAF does not fire in a background tab, and a stranded latch
    // would silently stop every future sync.
    window.setTimeout(run, 250);
  }

  // Observe <html>, not <body>: Turbo replaces <body> on every visit, and an
  // observer on the old one would never fire again.
  var observer = new MutationObserver(function (records) {
    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      // Changes INSIDE our nodes (the checkout clone's summary) are ours too.
      if (r.target && r.target.nodeType === 1 && r.target.closest && r.target.closest("[" + BADGE_ATTR + "]")) continue;
      // Our own inserts and removals are not a reason to re-sync.
      var ours = true;
      var nodes = [].slice.call(r.addedNodes).concat([].slice.call(r.removedNodes));
      for (var j = 0; j < nodes.length; j++) {
        var n = nodes[j];
        if (!(n.nodeType === 1 && (n.hasAttribute(BADGE_ATTR) || n.id === MODAL_HOST_ID))) {
          ours = false;
          break;
        }
      }
      if (!ours || !nodes.length) {
        requestSync();
        return;
      }
    }
  });

  var TURBO_SYNC_EVENTS = ["turbo:load", "turbo:render", "turbo:frame-render", "turbo:frame-load", "popstate"];

  // Before Turbo snapshots the page for its back/forward cache, take our nodes
  // out, so a restored snapshot never shows a dead teaser or an open scrim.
  function onBeforeCache() {
    closeModal();
    stripInjectedDom();
    state.triggers = [];
    modalHostEl = null;
    modalRoot = null;
  }

  // Turbo keeps this window alive across visits, so this counts how many
  // pages the overlay has survived. It answers "do we survive navigation" on
  // the next Turbo visit without another diagnostic.
  var turboVisits = 0;
  function onTurboLoad() {
    turboVisits++;
    console.info("[bliss] Turbo visit " + turboVisits + " survived: " + location.pathname + location.search);
  }

  function hook() {
    observer.observe(document.documentElement, { childList: true, subtree: true });
    TURBO_SYNC_EVENTS.forEach(function (ev) {
      (ev === "popstate" ? window : document).addEventListener(ev, requestSync);
    });
    document.addEventListener("turbo:load", onTurboLoad);
    document.addEventListener("turbo:before-cache", onBeforeCache);
    // A resize can rewrap the label; the wordmark is re-levelled on the sync.
    window.addEventListener("resize", requestSync);
  }

  function unhook() {
    observer.disconnect();
    TURBO_SYNC_EVENTS.forEach(function (ev) {
      (ev === "popstate" ? window : document).removeEventListener(ev, requestSync);
    });
    document.removeEventListener("turbo:load", onTurboLoad);
    document.removeEventListener("turbo:before-cache", onBeforeCache);
    document.removeEventListener("keydown", onKeydown, true);
    window.removeEventListener("resize", requestSync);
  }

  // =========================================================================
  // PROBE — what every guess resolved to, so a wrong figure is traceable.
  // =========================================================================

  function probe() {
    var stay = state.stay || {};
    return {
      host: location.hostname,
      chainParam: stay.chainParam,
      hotelParam: stay.hotelParam,
      hotelName: stay.hotelName,
      chainName: stay.chainName,
      stay: { checkin: stay.checkinIso, checkout: stay.checkoutIso, nights: stay.nights, source: stay.source, conflict: stay.conflict },
      dataLayer: { listEventsRead: state.itemEvents, items: state.items.length, sample: state.items.slice(0, 5) },
      mode: state.mode,
      checkout: (function () {
        var t = checkoutTrigger();
        if (!t) return null;
        var cOpt = confirmedOption(t);
        return {
          cardRowFound: !!t.co.card,
          flexPayRowFound: !!t.co.flex,
          flexPayHidden: !!(t.co.flex && t.co.flex.row.hasAttribute(HIDDEN_ATTR)),
          blissRowAfter: t.hostEl && t.co.flex && t.co.flex.row.nextSibling === t.hostEl ? "FlexPay row" : "not placed",
          styledFrom: t.hostEl ? "clone of the FlexPay row" : null,
          clone: t.build || null,
          rowShown: !!t.hostEl && t.hostEl.isConnected && getComputedStyle(t.hostEl).display !== "none",
          total: t.total ? { amount: t.total.text, label: t.total.label, basis: t.total.basis, why: t.total.why, source: t.total.source, subtotal: t.total.subtotal, taxes: t.total.taxes } : null,
          plan: t.preview ? (t.preview.eligible ? t.preview.options.map(function (o) { return o.frequency + " x" + o.numPayments + " of " + money(o.perPaymentAmountCents, cur(t)); }).join(", ") : t.preview.reason) : "none",
          selected: cOpt ? planLabel(cOpt.frequency) + " · " + cOpt.numPayments + " payments of " + money(cOpt.perPaymentAmountCents, cur(t)) : null,
        };
      })(),
      upliftWrappers: upliftEls().length,
      turboVisitsSurvived: turboVisits,
      planChoice: state.planChoice,
      cards: state.triggers.map(function (t) {
        return {
          name: t.name,
          rate: t.variant,
          matchedBy: t.matchedBy,
          placedBy: t.placedBy,
          itemPrice: t.item ? money(t.item.priceCents, cur(t)) : null,
          cardPrice: t.dom ? t.dom.text : null,
          cardPriceSays: t.dom ? t.dom.basis : null,
          source: t.amounts ? t.amounts.source : null,
          basis: t.amounts ? t.amounts.how : "no price",
          nightly: t.amounts ? money(t.amounts.nightlyCents, cur(t)) : null,
          stayTotal: t.amounts ? money(t.amounts.stayCents, cur(t)) : null,
          plan: t.preview ? (t.preview.eligible ? t.preview.options.map(function (o) { return o.frequency + " x" + o.numPayments; }).join(", ") : t.preview.reason) : "none",
          teaser: confirmedOption(t) ? "plan selected" : teaserLine(t),
        };
      }),
    };
  }

  // =========================================================================
  // BOOT
  // =========================================================================

  if (!CONFIG.force && !CONFIG.hostRe.test(location.hostname)) {
    console.warn("[bliss] not a SynXis page (" + location.hostname + "). Set window.__blissBeachfrontConfig = { force: true } to run anyway.");
    return;
  }

  sync();
  hook();

  var report = probe();
  if (report.hotelParam && report.hotelParam !== CONFIG.property.hotelId) {
    console.warn("[bliss] hotel=" + report.hotelParam + " is not Beachfront (" + CONFIG.property.hotelId + "). Running anyway.");
  }
  if (report.mode === "checkout") {
    console.info(
      "[bliss] Beachfront overlay installed on CHECKOUT. Bliss row " + (report.checkout.rowShown ? "shown" : "hidden") +
        " after the " + report.checkout.blissRowAfter + "; FlexPay " +
        (report.checkout.flexPayRowFound ? (report.checkout.flexPayHidden ? "hidden" : "left visible") : "not found") +
        "; plan " + (report.checkout.selected ? "preselected: " + report.checkout.selected : "not chosen yet") +
        ". No fee (free trial). __blissOverlay.probe().checkout for details."
    );
  } else {
    console.info(
      "[bliss] Beachfront overlay installed. " + report.upliftWrappers + " Uplift wrapper(s), " +
        report.dataLayer.items + " dataLayer item(s) from " + report.dataLayer.listEventsRead + " list event(s). " +
        "No plan-rules fetch (CSP), no fee (free trial). __blissOverlay.probe() for details."
    );
  }
  if (report.mode !== "checkout" && report.cards.length && console.table) console.table(report.cards);
  if (report.mode !== "checkout" && !report.upliftWrappers) {
    console.warn("[bliss] no " + CONFIG.cards.upliftSelector + " on the page yet. Uplift may still be loading; the observer will pick it up.");
  }

  window.__blissOverlay = {
    version: "beachfront-1",
    config: CONFIG,
    state: state,
    probe: probe,
    refresh: requestSync,
    clearPlan: clearPlan,
    paymentBoxHtml: paymentBoxHtml,
    __unobserve: unhook,
    __destroy: function () {
      unhook();
      closeModal();
      stripInjectedDom();
      state.triggers = [];
    },
  };
})();
