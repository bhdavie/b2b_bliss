/* eslint-disable */
/**
 * Bliss plan-selector overlay for a live Mews distributor page.
 *
 * Hosted script. Include it on the property's booking page and tell it which
 * merchant it is running for:
 *
 *   <script src="https://.../mews-overlay.js"
 *           data-bliss-merchant="j9l29fke"
 *           data-bliss-api="https://api.bliss-payments.com"></script>
 *
 * data-bliss-api is optional and defaults to DEFAULT_API_BASE below.
 *
 * On load it fetches that merchant's plan rules from the public API and
 * renders nothing until they arrive. It captures no card data and makes no
 * network call other than that one GET — everything else is read from the
 * page's own dataLayer.
 *
 * DEVELOPMENT: pasting into the console still works. With no script tag to
 * read, it looks for window.__blissOverlayConfig = { merchant, apiBase } and
 * fetches exactly as it would when hosted. Rules are ALWAYS fetched; there is
 * no paste-time rules override, because wrong rules put wrong money on a live
 * booking page.
 *
 * PASTE INTO THE TOP FRAME. The distributor renders its steps in a same-origin
 * child iframe while the dataLayer lives in the top frame, so the script walks
 * frames itself and puts each piece where it belongs. Pasting into the iframe
 * also works — it climbs to top for the data. See the FRAMES section.
 *
 * Verified against Mews Booking Engine 5770.0.0 dataLayer contract:
 *   distributorStartDateSelected -> startDate  (YYYY-MM-DD)
 *   distributorEndDateSelected   -> endDate    (YYYY-MM-DD)
 *   add_to_cart                  -> ecommerce.value, ecommerce.currency,
 *                                   ecommerce.items[0].item_name, .item_variant
 *   hotelId / hotelName appear on the distributor events
 * dataLayer is append-only, so every read takes the LAST occurrence.
 *
 * ---------------------------------------------------------------------------
 * PLAN MATH PROVENANCE
 *
 * The eligibility section below is a verbatim port of
 * frontend/lib/eligibility.ts, which is itself the sanctioned mirror of
 * backend/src/main/java/com/bliss/b2b/payments/PlanEligibilityService.java.
 * Function names, ordering and constants are preserved so the three stay
 * diffable. Do not "improve" the math here — the backend validates plan
 * creation and will reject a schedule this file invented.
 *
 * RESOLVED CONTRADICTION: CLAUDE.md used to say "Monthly means every 30 days".
 * The shipped code does not do that, and the code is correct — the doc was the
 * defect and has been corrected. Monthly means CALENDAR monthly: installments
 * collect on a fixed anchor day (the 2nd or the 16th, chosen by booking day),
 * with payment 2 pushed to the next anchor when the first is inside
 * MONTHLY_FIRST_INSTALLMENT_MIN_GAP_DAYS. Payday alignment is the point of the
 * anchors and it is what keeps off-session decline rates down, so a relative
 * +30 ladder was considered and rejected on those grounds, not on tidiness.
 * This file mirrors the CODE, which is what validates.
 *
 * ---------------------------------------------------------------------------
 * KNOWN ISSUES (accepted, not scheduled)
 *
 * 1. THE RATES FIGURE IS TAX-EXCLUSIVE, THE SUMMARY TOTAL IS TAX-INCLUSIVE.
 *    A Freehand rate card renders "$494.00 nightly (Facility Fee included,
 *    Taxes excluded)", and ga4_RatesLoaded matches what the card shows. The
 *    Summary total the guest eventually pays includes tax. So a per-payment
 *    figure shown on a rate card UNDERSTATES what the guest will actually be
 *    charged per installment, and the badge and the Summary trigger can quote
 *    different numbers for the same stay.
 *
 *    Not solved here deliberately. Solving it needs a decision on which basis
 *    a plan is written against, which is the same open question as item 4, and
 *    the tax rate is not in the dataLayer to apply even if that were settled.
 *
 * 2. THE TRIGGER AND THE MODAL QUOTE DIFFERENT BASES, BY DESIGN.
 *    The rate-card trigger teases the NIGHTLY rate over the installment count,
 *    mirroring perNightInstallmentLabel in frontend/app/inn/marbrook/page.tsx.
 *    The modal quotes the real per-payment figure off the STAY total, after the
 *    plan discount and less the deposit. The two do not reconcile, and cannot:
 *    the teaser is raw nightly rate (no discount, no deposit), so
 *    trigger x nights x installments lands on the undiscounted stay total while
 *    the modal's schedule sums to the discounted total minus the deposit.
 *
 *    On Freehand Queen, 2 nights: trigger reads $214/night over 2 installments
 *    ($427.50 / 2), implying $855.00; the modal quotes 2 x $346.27 against a
 *    $769.50 discounted total after a $76.95 deposit. Both figures are correct
 *    for their own basis. A guest who multiplies will not arrive at the modal's
 *    number. Accepted so the overlay matches the Marbrook teaser it is
 *    demoing alongside.
 *
 * 3. NO PAY-NOW / PAY-LATER SIGNAL EXISTS. The Mews Google Triggers Reference
 *    exposes no payment-timing, prepayment or deposit field on any event. The
 *    only payment-adjacent events are add_payment_info and purchase, both of
 *    which fire after the guest has committed, so neither can gate a badge at
 *    rate-selection time. A rate that charges in full at booking therefore
 *    looks identical to one that does not, and the overlay will offer a plan
 *    on both. CONFIG.rateCards.excludeRatePattern is the only lever, and it
 *    matches on rate name, which is a workaround rather than a signal.
 *
 * 4. THE SUMMARY AMOUNT BASIS IS STILL UNRESOLVED. Mews documents that "all
 *    prices currently presented via the Data Layer are gross prices, i.e.
 *    including taxes and fees", but that claim does not hold in practice: the
 *    reference capture recorded ecommerce.value 778 against an on-screen total
 *    of 899.78, and the Rates step is tax-exclusive per item 2. The documented
 *    claim is therefore not usable as evidence for either basis.
 *
 *    The RATES side is now settled, empirically rather than from the docs:
 *    prices are per-night, facility-fee-inclusive, tax-exclusive. See
 *    CONFIG.rateCards.priceIsPerNight. The SUMMARY side (ecommerce.value) is
 *    still an open product question, not a bug in this file.
 * ---------------------------------------------------------------------------
 */
(function () {
  "use strict";

  // Captured synchronously: document.currentScript is only non-null while the
  // script is executing, so it must be read before anything async happens.
  var CURRENT_SCRIPT = (function () {
    try {
      return document.currentScript || null;
    } catch (e) {
      return null;
    }
  })();

  var MERCHANT_ATTR = "data-bliss-merchant";
  var API_ATTR = "data-bliss-api";
  var DEFAULT_API_BASE = "https://api.bliss-payments.com";

  // =========================================================================
  // BLISS FEE
  //
  // Platform fee applied to the tax-inclusive Total when the Summary-step
  // figure is computed. Single source of truth for this file — change it here
  // and nowhere else.
  //
  // 5%, matching every fee source in the repo:
  //   backend   PlanCreationService.BLISS_FEE_RATE          = 0.05
  //   frontend  frontend/lib/blissFee.ts BLISS_FEE_RATE     = 0.05
  //   seed      demo-seed-marbrook.sql processing_fee_cents = 14700 against a
  //             294000 plan total, i.e. exactly 0.05
  //
  // Applied ON TOP of the total: the guest pays the fee and the hotel is paid
  // net, matching PlanCreationService.feeFor + buildSchedule, which add it to
  // the schedule the guest is charged rather than deducting it from the total.
  // =========================================================================
  var BLISS_FEE_RATE = 0.05;

  // =========================================================================
  // CONFIG — paste over this block per property.
  // =========================================================================
  var CONFIG = {
    /**
     * Merchant plan rules. POPULATED AT BOOT from
     * GET {apiBase}/api/v1/public/merchants/{slug}/plan-rules, never hardcoded:
     * these are per-property terms, and the trigger puts a dollar figure on
     * screen before the guest clicks anything, so a stale copy is wrong money
     * on a live booking page.
     *
     * Null until the fetch resolves. Nothing renders while it is null — boot()
     * is the only caller of start(), and it only calls it after assigning here.
     * There is deliberately no default and no fallback: if the fetch fails the
     * overlay does not run at all.
     *
     * Shape matches the 13 fields of PlanRules in frontend/lib/api.ts that
     * previewEligibility consults, same names and units.
     * @type {object|null}
     */
    rules: null,

    /**
     * THE AMOUNT BASIS IS UNRESOLVED. This single function decides every number
     * the overlay renders: the amount gates, the discount, the deposit, and the
     * per-payment split all derive from it.
     *
     * On the reference capture, ecommerce.value was 778 while the on-screen
     * total was 899.78 — ecommerce.value is the PRE-TAX room rate. Whether a
     * plan should be based on the pre-tax rate or the tax-inclusive total the
     * guest actually sees is an open product question, not a bug in this file.
     *
     * Default: ecommerce.value, because it is the only figure the dataLayer
     * contract guarantees. Swap in deriveAmountCentsFromOnScreenTotal below to
     * try the other basis.
     *
     * @param {object} dl parsed dataLayer snapshot (see readDataLayer)
     * @returns {number|null} integer cents, or null when unknown
     */
    deriveAmountCents: function (dl) {
      if (dl.value == null || !isFinite(dl.value)) return null;
      return Math.round(dl.value * 100);
    },

    /**
     * ALTERNATIVE BASIS, stubbed. Scrapes the tax-inclusive total off the page
     * instead of trusting ecommerce.value. The selector is a guess — Mews
     * distributors are themed per property and the markup varies, so confirm it
     * against the live page before relying on this. To use it:
     *   CONFIG.deriveAmountCents = CONFIG.deriveAmountCentsFromOnScreenTotal;
     *   window.__blissOverlay.refresh();
     */
    deriveAmountCentsFromOnScreenTotal: function (dl) {
      var sel = CONFIG.onScreenTotalSelector;
      var el = sel ? document.querySelector(sel) : null;
      return el ? parseMoneyTextToCents(el.textContent) : null;
    },

    /** Selector for the on-screen tax-inclusive total. Unverified. */
    onScreenTotalSelector: '[data-testid="reservation-total"], .total-price, .cart-total',

    // -----------------------------------------------------------------------
    // RATES STEP — per-rate-card placement.
    //
    // Captured live on the Freehand Rates step. Mews uses data-test-id,
    // hyphenated, NOT data-testid — an important detail, since querying the
    // undashed spelling silently returns zero and looks like "no such element"
    // rather than "wrong attribute name".
    //
    // Mews distributors are themed and versioned per property, so treat these
    // as per-property values in the same way CONFIG.rules is.
    // -----------------------------------------------------------------------
    rateCards: {
      /**
       * The repeating rate card container. This is the element the badge is
       * positioned against, so it is rate-item and not rates-container (the
       * list) or rate-item-name (a cell).
       */
      cardSelector: '[data-test-id="rate-item"]',

      /**
       * FALLBACK ONLY. The price element, resolved WITHIN a card. The primary
       * source is the ga4_RatesLoaded rates array; this is reached only when
       * that event is absent or no rate name matched the card.
       *
       * UNVERIFIED NESTING: localizedCurrency is present in the page's
       * data-test-id set, but the capture was a flat attribute list and did
       * not establish that it appears inside rate-item rather than only inside
       * the category card's from-price-wrapper. Confirm before relying on it;
       * if it is wrong the fallback yields null, which suppresses the badge
       * rather than showing a wrong number.
       */
      priceSelector: '[data-test-id="localizedCurrency"]',

      /**
       * The rate name, resolved within a card. Used to match the card to its
       * entry in the ga4_RatesLoaded rates array, and as the modal subtitle.
       * Scoping the match to this element rather than the card's whole
       * textContent stops a rate name that also appears in a description or a
       * discount badge from matching the wrong card.
       */
      labelSelector: '[data-test-id="rate-item-name"]',

      /**
       * True when a rate price is a nightly figure rather than the total for
       * the stay. Applies to BOTH sources: the ga4_RatesLoaded price and the
       * scrape fallback. Multiplied by dl.nights, derived from the distributor
       * start/end date events.
       *
       * Settled empirically on Freehand, not inferred: the same Queen search
       * returned 427.50 at 2 nights and 494.00 at 3 nights. A stay total would
       * have scaled; a nightly figure re-priced, which is what happened. The
       * card renders it as "nightly (Facility Fee included, Taxes excluded)".
       */
      priceIsPerNight: true,

      /**
       * Last-resort matching: if no rate name matches any card and the card
       * count equals the rate count, pair them by DOM order. Off by default
       * because it is positional guesswork, and a wrong pairing shows a
       * confident figure from the wrong rate.
       */
      matchByOrderFallback: false,

      /**
       * Rates whose name matches this regex get no badge.
       *
       * This exists because the dataLayer exposes NO pay-now/pay-later signal
       * at rate-selection time (confirmed against the Mews Google Triggers
       * Reference: the only payment-timing hints are add_payment_info and the
       * purchase trigger, both of which fire after the guest has committed).
       * A rate that charges in full at booking cannot be spread over time, so
       * until a real signal exists the only lever is the rate's name.
       *
       * Name matching is a workaround, not a signal. Set it per property.
       * @type {RegExp|null}
       */
      excludeRatePattern: null,

      /**
       * Where the pill goes inside the card.
       *
       * It is inserted as a full-width block sibling immediately after the
       * card's primary CTA, in normal flow. An earlier version positioned it
       * absolutely, which put it straight on top of the Book now button —
       * unacceptable on a live booking engine, and a hazard inherent to
       * absolute placement rather than a bad choice of corner. Normal flow
       * cannot overlap anything by construction.
       */
      placement: {
        /**
         * The card's primary CTA, resolved WITHIN a card. The pill is inserted
         * directly after this element's top-level container in the card.
         *
         * Left null on purpose. The fallback (last interactive element in the
         * card) is deterministic and safe, whereas price-footer-button is a
         * plausible-looking name from the captured attribute list whose nesting
         * and role are both unverified — if it turned out to be something other
         * than Book now, setting it would place the pill worse than the
         * fallback does. Confirm it, then set it for determinism.
         * @type {string|null}
         */
        ctaSelector: null,

        /** Gap above the pill, so it reads as its own line. */
        marginTopPx: 10,
      },
    },

    /**
     * Per-card amount, for the Rates step where there is no cart to read.
     *
     * Primary source is the ga4_RatesLoaded rates array, which carries id,
     * name, price and currency per rate. That is preferred over scraping
     * because it is a data contract rather than a rendering, it gives a stable
     * rate id to attribute the choice to, and it carries its own currency.
     * The scrape survives as a fallback for when the event has not fired or
     * the card cannot be matched to a rate by name.
     *
     * @param {Element} card the rate card container
     * @param {object} dl parsed dataLayer snapshot
     * @returns {{amountCents:number, currency:string|null, rateId:string|null,
     *            rateName:string|null, source:string}|null} null when unknown
     */
    resolveCardAmount: function (card, dl) {
      var rate = matchRateForCard(card, dl);
      if (rate) {
        if (CONFIG.rateCards.excludeRatePattern && CONFIG.rateCards.excludeRatePattern.test(rate.name || "")) {
          return null;
        }
        if (rate.price != null && isFinite(rate.price)) {
          var rateRaw = Math.round(rate.price * 100);
          var rateCents = toStayTotalCents(rateRaw, dl);
          if (rateCents == null) return null;
          return {
            amountCents: rateCents,
            nightlyAmountCents: toNightlyCents(rateRaw, dl),
            currency: rate.currency || null,
            rateId: rate.id || null,
            rateName: rate.name == null ? null : String(rate.name).replace(/\s+/g, " ").trim(),
            source: "ga4_RatesLoaded",
          };
        }
      }

      var sel = CONFIG.rateCards.priceSelector;
      if (!card || !sel) return null;
      // Not querySelector: a discounted rate renders two matches, and the first
      // is the struck-through original. See effectivePriceEl.
      var el = effectivePriceEl(card, sel);
      if (!el) return null;
      var text = String(el.textContent || "");
      rememberCurrencyHint(text);
      var raw = parseMoneyTextToCents(text);
      var cents = toStayTotalCents(raw, dl);
      if (cents == null) return null;
      return {
        amountCents: cents,
        nightlyAmountCents: toNightlyCents(raw, dl),
        currency: null,
        rateId: null,
        rateName: null,
        source: "scrape",
      };
    },

    /**
     * Currency for figures rendered before add_to_cart fires. The dataLayer has
     * no currency on the Rates step, so the overlay sniffs the symbol off the
     * scraped price and falls back to this. Set it per property to be certain.
     * @type {string|null}
     */
    currencyFallback: null,

    /**
     * DETAILS STEP — the inline block that replaced the floating corner pill.
     *
     * Selectors supplied directly rather than taken from a capture, so the
     * nesting relationship between the anchor and the total is unverified: the
     * block is inserted relative to the ANCHOR (the "You'll pay later" line),
     * which is the unambiguous instruction, and the total is read from
     * wherever total-bar-total lives. If the two turn out to sit in different
     * containers the block still lands under the anchor.
     */
    detailsStep: {
      /** The "You'll pay later based on your booking conditions." line. */
      anchorSelector: '[data-test-id="rate-settlement-rule-description-later"]',
      /**
       * The tax-inclusive Total AMOUNT. Basis for $Z.
       *
       * Note the -value suffix: total-bar-total is the label element, whose
       * text is the word "Total". Pointing at it resolved a real element that
       * parsed to null, so the block silently hid itself. The figure lives in
       * the sibling total-bar-total-value.
       */
      totalSelector: '[data-test-id="total-bar-total-value"]',
      /** Gap above the block, so it reads as its own line. */
      marginTopPx: 10,
    },

    /**
     * Frame walking. On Freehand the rate cards render in a same-origin child
     * iframe while the dataLayer lives in the top frame, so the overlay cannot
     * assume one document. See the FRAMES section.
     */
    frames: {
      /** How deep to recurse into nested same-origin frames. */
      maxDepth: 4,
    },

    /**
     * Property identity hook. Display-only today: the overlay never calls Bliss,
     * so nothing needs a merchant slug. dataLayer hotelId/hotelName do not map
     * to a Bliss slug on their own. Set this when the recorded choice needs to
     * be attributed to a merchant.
     */
    merchantSlug: null,

    /**
     * Bliss brand colours for the trigger line. Deliberately NOT the sampled
     * host accent: the trigger is Bliss speaking inside the property's page,
     * so it should read as ours rather than as another of the host's controls.
     * The host font family is still inherited, so it sits in the page's
     * typography without borrowing its colour.
     *
     * The modal keeps the sampled theme — it is a surface of its own and
     * benefits from looking native to the distributor it covers.
     *
     * These are the settled Bliss palette: violet #5A1BB5 for the accent and
     * the primary action, the warm sand ramp for dividers, and the ink ramp for
     * type. The names say what the values are, so a value change here cannot
     * leave a token called "lavender" holding a violet.
     */
    brand: {
      violet: "#5A1BB5", // accent: selected option, focus ring, tick, CTA fill
      // The RECOMMENDED chip only. The palette's violet wash, opaque by
      // definition rather than composited — an rgba fill or an opacity property
      // would let the card behind it show through, and would drag the chip's
      // ink text down with it. Violet sits on this at 8.25:1.
      violetTint: "#F4EFFF",
      ink: "#111112", // primary text
      inkMuted: "#8A8A8F", // secondary text (never a border; see divider)
      // Deep violet, one step down from `violet`. The primary action and the
      // selected state are different levels and should not share a fill: the
      // option border and the RECOMMENDED chip keep #5A1BB5.
      ctaBg: "#3F0F87", // primary button background
      onCta: "#ffffff", // primary button text, and the tick glyph on violet
      surface: "#ffffff",
      divider: "#E8E5E0", // dividers and inactive borders
      // Default corner for the smaller chrome: the schedule box, the chip and
      // the tick. Matches Freehand's own button radius; the sampled host radius
      // it replaced was producing pills on the option rows.
      radius: "4px",
      // The modal shell and the plan option cards, which read as cards rather
      // than as controls and carry a softer corner than the chrome inside them.
      radiusCard: "16px",
      // The primary button only. Fully rounded, matching the pill every settled
      // Bliss surface uses for its primary action.
      radiusPill: "999px",
    },

    /**
     * The confirmation now renders in place of the button, with the plan rows
     * still on screen so the guest can see and change what they picked, so the
     * modal stays open. Set true to close it on confirm instead.
     */
    closeModalOnConfirm: false,
  };

  // =========================================================================
  // MONEY TEXT PARSING
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
   * A rate figure to a stay total. Both Rates-step sources are nightly on the
   * properties seen so far, and the plan is against the whole stay, so this is
   * where the two meet. Returns null rather than guessing when the nights
   * count is unknown, which suppresses the badge instead of showing a figure
   * that is short by a factor of the stay length.
   */
  function toStayTotalCents(cents, dl) {
    if (cents == null) return null;
    if (!CONFIG.rateCards.priceIsPerNight) return cents;
    if (!dl || dl.nights == null || dl.nights <= 0) return null;
    return cents * dl.nights;
  }

  /**
   * The other direction: the nightly figure behind a rate price. The trigger
   * line quotes per-night, so it needs this rather than the stay total.
   */
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
   * text-decoration does not inherit as a computed value: a span inside a
   * <del> reports "none" for itself while still rendering with a line through
   * it. The ancestor walk is what catches that, along with plain <s>/<del>/
   * <strike> markup.
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
   * The price element a guest actually pays, from among a card's matches.
   *
   * Mews renders a discounted rate as TWO localizedCurrency elements: the
   * original struck through, then the effective price. A plain querySelector
   * took the first, so a discounted rate scraped at its undiscounted price —
   * both Freehand cards parsed 38900 even though Advance Purchase displays a
   * lower figure beneath the struck 389.00.
   *
   * STYLE-BASED, which is the fragile option, and deliberately so only because
   * nothing better exists: the captured data-test-id set for this distributor
   * has no attribute marking the struck element. rate-item-discount is present
   * but marks the discount badge, not the crossed-out price. A Mews CSS change
   * that switched strikethrough to a background line, a border, or an opacity
   * treatment would silently defeat this and return the original price again.
   * Swap to an attribute check the moment one exists.
   */
  function effectivePriceEl(card, sel) {
    var all;
    try {
      all = card.querySelectorAll(sel);
    } catch (e) {
      return null;
    }
    if (!all.length) return null;
    // Single match: unchanged behaviour, no style probing at all.
    if (all.length === 1) return all[0];
    for (var i = 0; i < all.length; i++) {
      if (!isStruckThrough(all[i], card)) return all[i];
    }
    // Every match struck through — pathological. Keep the old first-match
    // behaviour rather than returning nothing.
    return all[0];
  }

  /**
   * The card's DISPLAYED nightly price, in cents: tax-exclusive and
   * facility-fee-inclusive, the figure the guest reads on the card.
   *
   * Scraped unconditionally, independently of resolveCardAmount. That function
   * returns on the ga4_RatesLoaded path before it ever reaches its scrape
   * branch, and the ga4 price is a different basis (gross), so the trigger's
   * per-night figure cannot be taken from it. Deliberately NOT a fallback to
   * ga4: if the scrape fails this returns null and the trigger says nothing
   * per-night rather than quoting the wrong basis.
   */
  function scrapeNightlyCents(card) {
    var sel = CONFIG.rateCards.priceSelector;
    if (!card || !sel) return null;
    var el = effectivePriceEl(card, sel);
    if (!el) return null;
    return parseMoneyTextToCents(el.textContent);
  }

  /**
   * The Summary-step per-night figure:
   *
   *   Z = Total x (1 + BLISS_FEE_RATE) / nights / biweekly payment count
   *
   * Tax-INCLUSIVE, unlike the rate-card figure, because it derives from the
   * summary card's Total rather than a rate card's pre-tax nightly price. That
   * difference is why the Summary supporting line says only "No credit check"
   * while the rate-card one says "Pre-tax · No credit check".
   *
   * The pre-tax subtotal on the rate line is deliberately not an input: it has
   * no role in this formula.
   *
   * Returns null rather than guessing when either input is unusable, so a
   * failed read suppresses the figure instead of rendering a wrong one.
   */
  function summaryPerNightCents(totalCents, nights, numPayments) {
    if (totalCents == null || !isFinite(totalCents) || totalCents <= 0) return null;
    if (nights == null || nights <= 0) return null;
    if (!numPayments || numPayments <= 0) return null;
    var withFee = Math.round(totalCents * (1 + BLISS_FEE_RATE));
    return Math.round(withFee / nights / numPayments);
  }

  var SYMBOL_CURRENCY = { "$": "USD", "£": "GBP", "€": "EUR", "¥": "JPY", "₹": "INR" };

  /**
   * Best-effort currency for the pre-cart steps. Ambiguous by nature ($ is not
   * only USD), which is why CONFIG.currencyFallback outranks it.
   */
  function rememberCurrencyHint(text) {
    var m = /[$£€¥₹]|\b(USD|GBP|EUR|CHF|SEK|NOK|DKK|PLN|AUD|CAD)\b/.exec(String(text || ""));
    if (!m) return;
    state.currencyHint = SYMBOL_CURRENCY[m[0]] || m[0];
  }

  // =========================================================================
  // ELIGIBILITY — verbatim port of frontend/lib/eligibility.ts
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
  // FRAMES
  //
  // Diagnosed on Freehand: the rate cards render in a same-origin child iframe
  // while the dataLayer (46 events, including ga4_RatesLoaded) lives in the top
  // frame. Querying one document found neither everything nor nothing — it
  // found cards nowhere and data everywhere, with no error to show for it.
  //
  // So three roles are resolved independently, and re-resolved every sync:
  //
  //   data   the first frame, top-down, whose window.dataLayer has entries
  //   cards  EVERY same-origin frame whose document matches cardSelector, so
  //          there is no "which frame is the right one" guess to get wrong
  //   ui     the top-most reachable frame, which owns the modal and the summary
  //          pill. A position:fixed modal mounted inside the iframe would be
  //          clipped to the iframe's box instead of covering the viewport;
  //          mounted in top, its scrim covers the iframe too.
  //
  // Badges stay in the card frame deliberately: sitting in the card's own
  // normal flow, they scroll and clip with it and need no cross-frame
  // coordinate maths.
  //
  // Every window and document access is guarded. A cross-origin frame (the
  // ad.ipredictive.com one on Freehand) throws on .document, and a sandboxed
  // frame without allow-same-origin is indistinguishable from cross-origin.
  // Both are skipped, never thrown on.
  // =========================================================================

  function safeFrame(win) {
    if (!win) return null;
    try {
      var doc = win.document;
      if (!doc || !doc.documentElement) return null;
      return { win: win, doc: doc };
    } catch (e) {
      return null; // cross-origin, or an opaque sandboxed origin
    }
  }

  /** The top frame when it is reachable, otherwise this one. */
  function rootFrame() {
    var top = null;
    try {
      top = safeFrame(window.top);
    } catch (e) {
      top = null;
    }
    return top || safeFrame(window);
  }

  /** Depth-first walk of same-origin frames, deduped by document identity. */
  function collectFrames() {
    var out = [];
    var seen = [];
    var max = (CONFIG.frames && CONFIG.frames.maxDepth) || 4;

    function visit(frame, depth) {
      if (!frame || depth > max) return;
      for (var i = 0; i < seen.length; i++) if (seen[i] === frame.doc) return;
      seen.push(frame.doc);
      out.push(frame);
      var kids, n;
      try {
        kids = frame.win.frames;
        n = kids.length;
      } catch (e) {
        return;
      }
      for (var j = 0; j < n && j < 50; j++) {
        var child = null;
        try {
          child = safeFrame(kids[j]);
        } catch (e) {
          child = null;
        }
        if (child) visit(child, depth + 1);
      }
    }

    visit(rootFrame(), 0);
    // Covers a paste landing in a frame the walk down from root cannot reach.
    visit(safeFrame(window), 0);
    return out;
  }

  function frameHasCards(frame) {
    var sel = CONFIG.rateCards && CONFIG.rateCards.cardSelector;
    if (!sel || !frame.doc.body) return false;
    try {
      return frame.doc.querySelectorAll(sel).length > 0;
    } catch (e) {
      return false;
    }
  }

  /**
   * Assigns the three roles. Recomputed every sync so an iframe that mounts
   * late, or navigates and swaps its document out, is picked up rather than
   * leaving the overlay bound to a document that no longer exists.
   */
  function resolveFrames() {
    var all = collectFrames();
    var here = safeFrame(window);
    var fallback = all[0] || here;

    var data = null;
    for (var i = 0; i < all.length && !data; i++) {
      var arr = null;
      try {
        arr = all[i].win.dataLayer;
      } catch (e) {
        arr = null;
      }
      if (arr && typeof arr.length === "number" && arr.length > 0) data = all[i];
    }

    var cards = [];
    for (var j = 0; j < all.length; j++) if (frameHasCards(all[j])) cards.push(all[j]);

    // all[0] is the root, so ui is top whenever top is reachable.
    return { all: all, data: data || fallback, cards: cards, ui: fallback };
  }

  // =========================================================================
  // DATALAYER
  // =========================================================================

  /** Parses YYYY-MM-DD as a LOCAL date. new Date("2026-12-25") would be UTC. */
  function parseLocalDate(iso) {
    if (!iso || typeof iso !== "string") return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    if (!m) return null;
    var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return isNaN(d.getTime()) ? null : d;
  }

  function startOfToday() {
    var n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate());
  }

  /** The resolved data frame's dataLayer, which is usually not this frame's. */
  function dataLayerArray() {
    var f = state.frames && state.frames.data;
    if (!f) return null;
    try {
      var arr = f.win.dataLayer;
      return arr && typeof arr.length === "number" ? arr : null;
    } catch (e) {
      return null;
    }
  }

  /** dataLayer is append-only: walk backwards and take the first match. */
  function lastEvent(dl, name) {
    if (!dl || typeof dl.length !== "number") return null;
    for (var i = dl.length - 1; i >= 0; i--) {
      var e = dl[i];
      if (e && typeof e === "object" && e.event === name) return e;
    }
    return null;
  }

  /** First non-null value for `key` scanning backwards across all entries. */
  function lastValue(dl, key) {
    if (!dl || typeof dl.length !== "number") return null;
    for (var i = dl.length - 1; i >= 0; i--) {
      var e = dl[i];
      if (e && typeof e === "object" && e[key] != null) return e[key];
    }
    return null;
  }

  /**
   * ga4_RatesLoaded carries the rates shown on the Rates step. Mews documents
   * this only as "Array of rates shown to user, together with their currency
   * and gross price" — id and name are present in practice but undocumented,
   * so every field is treated as optional here.
   */
  function normalizeRates(raw) {
    if (!raw || typeof raw.length !== "number") return [];
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var r = raw[i];
      if (!r || typeof r !== "object") continue;
      var price = r.price == null ? null : Number(r.price);
      out.push({
        id: r.id == null ? null : String(r.id),
        name: r.name == null ? null : String(r.name),
        price: price != null && isFinite(price) ? price : null,
        currency: r.currency == null ? null : String(r.currency),
      });
    }
    return out;
  }

  function readDataLayer() {
    var dl = dataLayerArray();
    var startEvt = lastEvent(dl, "distributorStartDateSelected");
    var endEvt = lastEvent(dl, "distributorEndDateSelected");
    var cartEvt = lastEvent(dl, "add_to_cart");
    var ratesEvt = lastEvent(dl, "ga4_RatesLoaded");

    var ecom = (cartEvt && cartEvt.ecommerce) || {};
    var items = ecom.items || [];
    var item0 = items[0] || {};

    var startIso = startEvt ? startEvt.startDate : null;
    var endIso = endEvt ? endEvt.endDate : null;
    var checkin = parseLocalDate(startIso);
    var checkout = parseLocalDate(endIso);
    var rates = normalizeRates(ratesEvt && ratesEvt.rates);

    return {
      rates: rates,
      checkinIso: startIso || null,
      checkoutIso: endIso || null,
      checkin: checkin,
      checkout: checkout,
      nights: checkin && checkout ? daysBetween(checkin, checkout) : null,
      value: ecom.value == null ? null : Number(ecom.value),
      // add_to_cart has not fired on the Rates step, so fall back to the
      // currency the rates array carries. Still null before either arrives;
      // resolve display currency through cur().
      currency: ecom.currency || (rates[0] && rates[0].currency) || null,
      itemName: item0.item_name || null,
      itemVariant: item0.item_variant || null,
      hotelId: lastValue(dl, "hotelId"),
      hotelName: lastValue(dl, "hotelName"),
      sawCart: !!cartEvt,
    };
  }

  // -------------------------------------------------------------------------
  // RATE MATCHING — card element to its ga4_RatesLoaded entry.
  // -------------------------------------------------------------------------

  /** Rate names arrive with stray whitespace ("...10% OFF "), so normalize hard. */
  function normalizeName(s) {
    return String(s == null ? "" : s).replace(/\s+/g, " ").trim().toLowerCase();
  }

  function cardMatchText(card) {
    if (!card) return "";
    var sel = CONFIG.rateCards.labelSelector;
    var el = sel ? card.querySelector(sel) : null;
    return normalizeName((el || card).textContent);
  }

  function matchRateForCard(card, dl) {
    if (!card || !dl || !dl.rates || !dl.rates.length) return null;
    var hay = cardMatchText(card);
    var best = null;
    var bestLen = 0;
    if (hay) {
      for (var i = 0; i < dl.rates.length; i++) {
        var name = normalizeName(dl.rates[i].name);
        if (!name || hay.indexOf(name) === -1) continue;
        // Longest name wins, so a short name that happens to be a substring of
        // a longer one ("Flexible Rate" inside "Flexible Rate - Non Ref")
        // cannot steal the match.
        if (name.length > bestLen) {
          best = dl.rates[i];
          bestLen = name.length;
        }
      }
    }
    if (best) return best;
    if (!CONFIG.rateCards.matchByOrderFallback || !CONFIG.rateCards.cardSelector) return null;
    var cards;
    try {
      // The card's OWN document, which is the iframe, not this frame.
      cards = (card.ownerDocument || document).querySelectorAll(CONFIG.rateCards.cardSelector);
    } catch (e) {
      return null;
    }
    if (cards.length !== dl.rates.length) return null;
    for (var j = 0; j < cards.length; j++) {
      if (cards[j] === card) return dl.rates[j];
    }
    return null;
  }

  // =========================================================================
  // HOST THEME SAMPLING
  // Mews distributors are themed per property, so read the live page rather
  // than shipping a palette.
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

  /**
   * Sampled from the frame that owns the cards, not the top frame — the design
   * worth matching is the booking engine's, and the top frame may be a host
   * site with an unrelated palette. The modal renders in top but is themed
   * from here, which is what keeps it looking native to the distributor.
   */
  function sampleHostTheme(win) {
    win = win || window;
    var doc = win.document;
    if (!doc || !doc.body) win = window, doc = window.document;
    var bodyCs = win.getComputedStyle(doc.body);

    // Accent: the most saturated opaque button background on the page, which on
    // a distributor is almost always the primary CTA.
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
      accentText: accent ? contrastOn(parseRgb(accent)) : (dark ? "#ffffff" : "#111111"),
      radius: radius || "8px",
    };
  }

  function contrastOn(bg) {
    if (!bg) return "#ffffff";
    return luminance(bg) > 0.6 ? "#111111" : "#ffffff";
  }

  // =========================================================================
  // FORMATTING
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

  // =========================================================================
  // OVERLAY
  //
  // Three parts, which do not all live in the same frame — see FRAMES:
  //   1. Rate-card pills, in the CARD frame. One per card on the Rates step,
  //      inserted as a full-width block sibling immediately after the card's
  //      CTA, in normal flow. No host node is wrapped, moved, reparented or
  //      restyled — the only mutation is one added child, which a re-render
  //      may discard and the observer then re-adds.
  //   2. Summary trigger, in the UI frame. Fixed bottom-right, appears once the
  //      cart carries a value, so from the Summary step onward.
  //   3. One shared modal, in the UI frame, mounted hidden and shown only on
  //      click. Until the guest clicks a trigger nothing of ours covers host
  //      content.
  //
  // Every injected node owns its own shadow root, so host CSS cannot reach in
  // and ours cannot leak out.
  // =========================================================================

  var LEGACY_HOST_ID = "bliss-plan-overlay-host";
  var SUMMARY_HOST_ID = "bliss-plan-summary-host";
  var MODAL_HOST_ID = "bliss-plan-modal-host";
  var BADGE_ATTR = "data-bliss-badge";
  var DECORATED_ATTR = "data-bliss-plan"; // marks a card we have already injected into
  // No longer written: the pill sits in normal flow and needs no positioned
  // ancestor. Kept so that a page still carrying the previous version's
  // position:relative gets it reverted on paste or destroy.
  var POSITIONED_ATTR = "data-bliss-positioned";

  var state = {
    dl: null,
    theme: null,
    currencyHint: null,
    frames: null, // {all, data, cards, ui} from resolveFrames()
    // The confirmed plan for this stay, session-level rather than per-trigger.
    // The rate-card trigger that recorded it is unmounted by the time the guest
    // reaches Details, so State A cannot key off that trigger's own `confirmed`.
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
   * before scheduling — so an rAF that never runs would strand that latch and
   * silently kill the observer for the rest of the session. Whichever fires
   * first wins; the other is a no-op.
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

  /** The window that owns an element, for getComputedStyle across frames. */
  function ownerWin(el) {
    var d = el && el.ownerDocument;
    return (d && d.defaultView) || window;
  }

  /**
   * Element factory bound to a document. Nodes must be created by the document
   * that will own them, so every render function opens by binding this to the
   * right frame rather than closing over one global `document`.
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

  /** Per-trigger currency: the matched rate's own, then the cart's, then config. */
  function cur(t) {
    if (t && t.currency) return t.currency;
    if (state.dl && state.dl.currency) return state.dl.currency;
    return CONFIG.currencyFallback || state.currencyHint || "USD";
  }

  // -------------------------------------------------------------------------
  // TEARDOWN — makes a re-paste of this file idempotent.
  // -------------------------------------------------------------------------

  function stripInjectedDomIn(doc) {
    [LEGACY_HOST_ID, SUMMARY_HOST_ID, MODAL_HOST_ID].forEach(function (id) {
      var el = doc.getElementById(id);
      if (el && el.parentNode) el.parentNode.removeChild(el);
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

  /** Sweeps every reachable frame — badges live in the iframe, hosts in top. */
  function stripInjectedDom() {
    var frames = collectFrames();
    for (var i = 0; i < frames.length; i++) {
      try {
        stripInjectedDomIn(frames[i].doc);
      } catch (e) {
        /* ignore */
      }
    }
  }

  function destroyExisting() {
    var frames = collectFrames();
    for (var i = 0; i < frames.length; i++) {
      var prev = null;
      try {
        prev = frames[i].win.__blissOverlay;
      } catch (e) {
        prev = null;
      }
      if (!prev) continue;
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
      try {
        delete frames[i].win.__blissOverlay;
      } catch (e) {
        /* ignore */
      }
    }
    stripInjectedDom();
  }

  destroyExisting();

  // -------------------------------------------------------------------------
  // STYLES
  // -------------------------------------------------------------------------

  function baseCss(theme) {
    return (
      ":host{all:initial}" +
      "*{box-sizing:border-box;margin:0;padding:0;font-family:" + theme.font + "}"
    );
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
      ".trig{display:block;width:100%;margin:0;padding:0;background:none;border:0;" +
      "border-radius:0;box-shadow:none;color:" + ink + ";font-size:12px;line-height:1.45;" +
      "cursor:pointer;text-align:left;white-space:normal;overflow-wrap:break-word}" +
      ".trig:hover .amt{text-decoration:underline}" +
      ".trig:focus-visible{outline:2px solid " + violet + ";outline-offset:2px}" +
      // Glyph is white, not ink: the tick's fill moved from lavender to violet,
      // and ink on violet is 2.03:1. White on violet is 9.3:1.
      ".tick{display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;" +
      "border-radius:" + radius + ";background:" + violet + ";color:" + CONFIG.brand.onCta + ";font-size:10px;" +
      "margin-right:7px;vertical-align:middle}" +
      ".sep{margin:0 5px;opacity:.55}" +
      ".amt{font-weight:600}" +
      // Supporting line under the rate-card main line. display:block is what
      // puts it on its own row beneath the inline main line.
      ".sub{display:block;margin-top:2px;font-size:11px;font-weight:400;color:" + inkMuted + "}" +
      // Details step: "See details" reads as a link beneath the main line, not
      // as another button competing with the host's Next control.
      ".link{display:block;margin-top:3px;padding:0;background:none;border:0;font-size:11px;" +
      "font-weight:600;color:" + ink + ";text-decoration:underline;cursor:pointer;text-align:left}" +
      // Details block: right-aligned to sit under the "You'll pay later" line
      // rather than at the card's left edge. Declared AFTER .trig and .link so
      // it wins on order at equal specificity. Sets colour explicitly because
      // State A's container is not a .trig and would otherwise inherit the
      // initial black from :host{all:initial}.
      ".details{text-align:right;color:" + ink + "}" +
      // text-align on .details cannot move this: .link is display:block, and
      // text-align only positions INLINE-level content. A <button> also uses
      // shrink-to-fit sizing even when block, so the box hugs its text and sits
      // flush left — and right-aligning text inside a box that is exactly as
      // wide as its text is a no-op. Give the box a definite width so the auto
      // left margin resolves, and it is pushed right as a box.
      ".details .link{display:block;width:fit-content;margin-left:auto;margin-right:0;text-align:right}" +
      // The summary trigger floats over the host page rather than sitting in a
      // card, so it keeps a surface and a shadow to stay legible against
      // whatever is behind it, and stays on one line.
      // The floating pill is gone; the Details block sits inline in the host
      // card, so it needs no surface of its own to stay legible.
      ".trig[disabled]{cursor:default}"
    );
  }

  /**
   * The modal is the one surface that does NOT take the sampled host palette.
   * Sampling made it wear the property's brand — on Freehand that meant a red
   * accent and red CTA, which read as the hotel speaking rather than Bliss.
   * Only `theme` for the FONT is still consulted (via baseCss), so the modal
   * sits in the page's typography while staying in Bliss colours.
   *
   * The badges and the summary pill still sample: they sit inside the host's
   * own layout and need its surface and hairline to look placed rather than
   * pasted on. See triggerCss.
   */
  function modalCss(theme) {
    var b = CONFIG.brand;
    return (
      baseCss(theme) +
      ".scrim{position:fixed;top:0;right:0;bottom:0;left:0;background:rgba(0,0,0,.44);" +
      "display:flex;align-items:center;justify-content:center;padding:16px}" +
      ".bliss-card{width:560px;max-width:100%;max-height:calc(100vh - 32px);overflow:auto;background:" + b.surface +
      ";color:" + b.ink + ";border:1px solid " + b.divider + ";border-radius:" + b.radiusCard +
      ";box-shadow:0 18px 56px rgba(0,0,0,.32)}" +
      ".bliss-card:focus{outline:none}" +
      ".head{display:flex;align-items:flex-start;gap:12px;padding:22px 24px;border-bottom:1px solid " + b.divider + "}" +
      ".head h2{font-size:17px;font-weight:600;line-height:1.3}" +
      ".head p{font-size:13px;color:" + b.inkMuted + ";margin-top:4px;line-height:1.4}" +
      ".x{margin-left:auto;background:none;border:0;cursor:pointer;font-size:20px;line-height:1;color:" + b.inkMuted + "}" +
      ".body{padding:20px 24px 24px}" +
      ".ctx{font-size:13px;color:" + b.inkMuted + ";margin-bottom:2px;line-height:1.5}" +
      // Fine print under the summary line, tracking the step's basis.
      ".fine{font-size:11px;color:" + b.inkMuted + ";margin-bottom:12px;line-height:1.4}" +
      // Collapsed-by-default schedule disclosure.
      ".disc{display:block;width:100%;text-align:left;margin:2px 0 8px;padding:8px 0;background:none;" +
      "border:0;border-top:1px solid " + b.divider + ";color:" + b.ink +
      ";font-size:12px;font-weight:600;cursor:pointer}" +
      ".sched{margin:0 0 12px;border:1px solid " + b.divider + ";border-radius:" + b.radius + "}" +
      ".sched .row{display:flex;align-items:center;gap:10px;padding:8px 12px;font-size:12px;" +
      "border-bottom:1px solid " + b.divider + "}" +
      ".sched .row:last-child{border-bottom:0}" +
      ".sched .n{width:18px;color:" + b.inkMuted + "}" +
      ".sched .d{color:" + b.ink + "}" +
      ".sched .v{margin-left:auto;font-weight:600;color:" + b.ink + "}" +
      ".opt{display:flex;align-items:center;gap:10px;width:100%;text-align:left;padding:11px 12px;margin-bottom:8px;" +
      "background:transparent;color:" + b.ink + ";border:1px solid " + b.divider +
      ";border-radius:" + b.radiusCard + ";cursor:pointer}" +
      ".opt[aria-pressed=\"true\"]{border-color:" + b.violet + ";border-width:2px;padding:10px 11px}" +
      ".opt .lbl{font-size:13px;font-weight:600}" +
      ".opt .sub{font-size:11px;color:" + b.inkMuted + ";margin-top:2px}" +
      ".opt .amt{margin-left:auto;text-align:right}" +
      ".opt .amt b{font-size:14px;font-weight:600;display:block}" +
      ".opt .amt span{font-size:11px;color:" + b.inkMuted + "}" +
      ".tag{display:inline-block;font-size:9px;letter-spacing:.4px;text-transform:uppercase;padding:2px 6px;" +
      "border-radius:" + b.radius + ";background:" + b.violetTint +
      ";border:1px solid " + b.violet + ";color:" + b.ink +
      ";margin-left:6px;vertical-align:middle}" +
      ".cta{width:100%;padding:12px;border:0;border-radius:" + b.radiusPill + ";background:" + b.ctaBg +
      ";color:" + b.onCta + ";font-size:13px;font-weight:600;cursor:pointer;margin-top:4px}" +
      // Sand fill with muted ink, not a half-opacity violet: at .5 the pill
      // composited to a pale lavender under white text, which is both a
      // failing pair and a tint-only colour used as a fill.
      ".cta[disabled]{background:" + b.divider + ";color:" + b.inkMuted + ";cursor:default}" +
      ".note{font-size:11px;color:" + b.inkMuted + ";margin-top:10px;line-height:1.45}" +
      ".msg{font-size:12px;color:" + b.inkMuted + ";line-height:1.5}" +
      // Sits where the button was: same top margin and vertical padding, so the
      // card does not resize when the button is swapped for it. Body copy in
      // the secondary ink, no chrome and no glyph.
      // The receipt's subject line. 14px matches the option row's amount, the
      // largest thing in the body it replaces.
      ".plan{margin:2px 0 0;font-size:14px;font-weight:600;line-height:1.4;color:" + b.ink + "}" +
      // Primary ink, and ruled off the disclaimer list above it with the same
      // hairline .disc uses above Payment schedule, so it reads as a change of
      // state rather than a fourth disclaimer.
      ".confirmed{margin-top:4px;padding:12px 0;border-top:1px solid " + b.divider +
      ";font-size:13px;line-height:1.45;color:" + b.ink + "}" +
      // Text control, not a filled button: it is the quieter of the two actions
      // in the reopened state. UA button styling cleared explicitly.
      ".textbtn{display:block;width:100%;margin-top:10px;padding:6px 0;background:none;border:0;" +
      "font-size:13px;line-height:1.45;color:" + b.inkMuted + ";cursor:pointer;text-align:center}" +
      ".textbtn:hover{text-decoration:underline}" +
      // Below the phone breakpoint the modal becomes a bottom sheet.
      "@media (max-width:420px){.scrim{align-items:flex-end;padding:0}" +
      ".bliss-card{width:100%;max-width:100%;max-height:88vh;border-radius:" + b.radiusCard + " " + b.radiusCard + " 0 0}}"
    );
  }

  // -------------------------------------------------------------------------
  // PLAN MATH PER TRIGGER
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
    // most payments. That is what makes the "From" claim truthful: no other
    // cadence produces a lower number.
    //
    // The numerator is the scraped tax-exclusive nightly price, not
    // t.nightlyAmountCents (which is ga4-derived and gross), so this figure
    // deliberately does not reconcile with the modal. The modal continues to
    // quote the real per-payment amounts off the stay total; only the teaser
    // is per-night.
    if (t.kind === "rate-card" && t.scrapedNightlyCents != null) {
      var spread = optionByFrequency(preview, "biweekly");
      if (!spread) {
        spread = preview.options[0];
        for (var j = 1; j < preview.options.length; j++) {
          if (preview.options[j].numPayments > spread.numPayments) spread = preview.options[j];
        }
      }
      var perNight = Math.round(t.scrapedNightlyCents / spread.numPayments);
      return "From " + money(perNight, cur(t)) + "/night over time";
    }

    var unit = opt.frequency === "monthly" ? "/mo" : " every 2 weeks";
    return "from " + money(opt.perPaymentAmountCents, cur(t)) + unit;
  }

  /**
   * State B's figure on the Details step: the tax- and fee-inclusive per-night
   * amount. Uses the biweekly count, falling back to the highest-count
   * eligible option, so "starting at" stays truthful.
   *
   * Returns null when the Total or the nights count could not be read, which
   * suppresses the block rather than quoting a figure off a partial basis.
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
  // TRIGGER
  // -------------------------------------------------------------------------

  // One-shot, so the per-mutation sync cannot spam. Reports both the sampled
  // font and the one actually applied, which is how a sampler regression
  // (Times against a sans-serif host) becomes visible instead of just looking
  // slightly wrong.
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
    // A badge's shadow root belongs to the card frame's document, not this one.
    var h = domFor(t.hostEl.ownerDocument);
    var root = t.root;
    root.innerHTML = "";
    root.appendChild(h("style", { text: triggerCss(state.theme) }));

    var kids;
    if (t.kind === "details") {
      // :host{all:initial} severs inheritance, so the block cannot pick up the
      // host font on its own. Read it off the element the block was inserted
      // next to — the most reliable source available, and immune to whichever
      // frame the sampler happened to choose. Emitted after the main sheet so
      // it overrides baseCss's *{font-family:...}.
      // Read family, size and weight off the ANCHOR — the host's own "You'll
      // pay later based on your booking conditions" line — so the block matches
      // it rather than approximating with hardcoded values. Falls back to the
      // host container for family only if the anchor has gone.
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
        root.appendChild(
          h("style", {
            text:
              "*{font-family:" + face.family + "}" +
              // Main line and the See details control both track the anchor.
              ".details .amt,.details .link{font-size:" + face.size + ";font-weight:" + face.weight + "}",
          })
        );
      }
      reportDetailsFont(face);

      var block;
      if (state.planChoice) {
        // STATE A — a plan was selected at the Rates step.
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
          t.hostEl.style.display = "none";
          return;
        }
        // A button, not a div: the whole block opens the modal, same as a
        // rate-card trigger, and a button is keyboard reachable for free.
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
          [
            h("span", { class: "amt", text: dLine }),
            h("span", { class: "sub", text: "No credit check" }),
          ]
        );
      }
      t.hostEl.style.display = "block";
      root.appendChild(block);
      return;
    }

    var cOpt = confirmedOption(t);
    if (cOpt) {
      kids = [
        h("span", { class: "tick", text: "✓" }),
        h("span", { text: "Plan selected" }),
        h("span", { class: "sep", text: "·" }),
        h("span", {
          class: "amt",
          text:
            cOpt.numPayments +
            (cOpt.numPayments === 1 ? " payment of " : " payments of ") +
            money(cOpt.perPaymentAmountCents, cur(t)),
        }),
      ];
    } else {
      var line = fromLine(t);
      if (!line) {
        // Nothing worth showing. Stay invisible rather than explain ourselves
        // on top of the host page.
        t.hostEl.style.display = "none";
        return;
      }
      if (t.kind === "rate-card" && t.scrapedNightlyCents != null) {
        // The supporting line is gated on the scrape, not just on the kind: it
        // describes the scraped tax-exclusive figure, so if fromLine fell
        // through to the ga4-derived generic line the "Pre-tax" claim would be
        // false and the line is omitted rather than shown against the wrong
        // basis.
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
    state.triggers.forEach(renderTrigger);
  }

  // -------------------------------------------------------------------------
  // MODAL
  // -------------------------------------------------------------------------

  var modalHostEl = null;
  var modalRoot = null;

  function ensureModalHost() {
    var f = state.frames && state.frames.ui;
    if (!f || !f.doc.body) return;
    // Rebuild if the UI frame's document was swapped out under us.
    if (modalHostEl && modalHostEl.isConnected && modalHostEl.ownerDocument === f.doc) return;
    if (modalHostEl && modalHostEl.parentNode) modalHostEl.parentNode.removeChild(modalHostEl);
    modalHostEl = f.doc.createElement("div");
    modalHostEl.id = MODAL_HOST_ID;
    modalHostEl.style.position = "fixed";
    modalHostEl.style.top = "0";
    modalHostEl.style.right = "0";
    modalHostEl.style.bottom = "0";
    modalHostEl.style.left = "0";
    modalHostEl.style.zIndex = "2147483647";
    modalHostEl.style.display = "none";
    modalRoot = modalHostEl.attachShadow({ mode: "open" });
    f.doc.body.appendChild(modalHostEl);
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

  // Focus can be inside the iframe while the modal is mounted in top, so the
  // Escape handler has to be bound in every reachable frame.
  var keydownDocs = [];

  function bindKeydown() {
    unbindKeydown();
    var frames = (state.frames && state.frames.all) || [];
    for (var i = 0; i < frames.length; i++) {
      try {
        frames[i].doc.addEventListener("keydown", onKeydown, true);
        keydownDocs.push(frames[i].doc);
      } catch (e) {
        /* ignore */
      }
    }
  }

  function unbindKeydown() {
    for (var i = 0; i < keydownDocs.length; i++) {
      try {
        keydownDocs[i].removeEventListener("keydown", onKeydown, true);
      } catch (e) {
        /* ignore */
      }
    }
    keydownDocs = [];
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
    // The modal is mounted in the UI frame, which is not the card's frame.
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
    // the decision — the plan rows, the schedule disclosure, the basis line and
    // the policy list — is dropped rather than left for them to re-read. Only
    // the head above stays.
    var confirmedOpt = confirmedOption(t);
    if (confirmedOpt) {
      var reopened = !state.modal.justConfirmed;
      body.appendChild(
        h("div", { class: "plan", text: planSummary(confirmedOpt, currency) })
      );
      body.appendChild(
        h("div", {
          class: "confirmed",
          text: reopened
            ? "You selected the " + planLabel(confirmedOpt.frequency) +
              " plan. Continue to checkout to finish."
            : "Plan selected. Continue to checkout and pay with your card as usual.",
        })
      );
      body.appendChild(
        h("button", { class: "cta", type: "button", text: "Back to booking", onClick: closeModal })
      );
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
              // The Details trigger DERIVES confirmed from state.planChoice, so
              // re-derive before rendering, as clearSelection does.
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
      lbl.firstChild.appendChild(
        doc.createTextNode(opt.frequency === "biweekly" ? "Every 2 weeks" : "Monthly")
      );
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
              // the guest can select the row they just moved to. Cleared on
              // every trigger, matching clearSelection: one plan per stay.
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
                text: money(
                  last ? chosen.finalPaymentAmountCents : chosen.perPaymentAmountCents,
                  currency
                ),
              }),
            ])
          );
        });
        body.appendChild(rows);
      }
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
      h("div", { class: "note", text: "No card needed here. You will finish checkout the usual way." })
    );

    mountModalCard(h, head, body);
  }

  /**
   * Backs a trigger all the way out of a plan: drops the modal's selection and
   * the recorded confirmation together, so the modal returns to its unselected
   * state and the trigger reverts to its "Spread this stay over time" text.
   *
   * Both are cleared by either entry point. Clearing only one would leave the
   * trigger claiming a plan the modal no longer shows as selected.
   */
  function clearSelection(t) {
    if (state.modal) state.modal.selected = null;
    // One plan per stay, so cancelling clears it everywhere: the session-level
    // record the Details block reads, and every trigger's own copy. Clearing
    // only the clicked trigger would leave another surface still claiming it.
    state.planChoice = null;
    state.triggers.forEach(function (x) {
      x.confirmed = null;
    });
    // recompute before rendering: on the Details trigger `confirmed` is DERIVED
    // from state.planChoice rather than owned, so re-deriving here keeps the
    // clear from depending on the next sync happening to arrive.
    recompute();
    renderAllTriggers();
    renderModal();
  }

  function mountModalCard(h, head, body) {
    var card = h("div", { class: "bliss-card", role: "dialog", "aria-modal": "true", tabindex: "-1" }, [head, body]);
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
   * The live option backing a confirmation, resolved against the CURRENT
   * preview and therefore the current step's basis.
   *
   * Confirmations deliberately store no amount. The guest confirms on Rates,
   * where the basis is the pre-tax stay total, then reaches Details, where it
   * is the tax-inclusive Total plus fee. A captured amount would still read the
   * Rates figure while the option row beside it read the Details one — which is
   * exactly the divergence this removes. Only the frequency is durable; every
   * figure is derived at render.
   */
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

  function confirmedOption(t) {
    if (!t || !t.confirmed || !t.preview) return null;
    return optionByFrequency(t.preview, t.confirmed.frequency);
  }

  function confirmPlan(t, option) {
    // Frequency and count only — no amount. See confirmedOption.
    t.confirmed = { frequency: option.frequency, numPayments: option.numPayments };
    var choice = {
      frequency: option.frequency,
      numPayments: option.numPayments,
      perPaymentAmountCents: option.perPaymentAmountCents,
      finalPaymentAmountCents: option.finalPaymentAmountCents,
      dueDates: option.dueDates.slice(),
      depositAmountCents: t.preview ? t.preview.depositAmountCents : 0,
      amountCents: t.amountCents,
      // The per-night basis the trigger teased, kept so a recorded choice can
      // be reconciled against what the guest was shown before clicking.
      nightlyAmountCents: t.nightlyAmountCents,
      currency: cur(t),
      source: t.kind, // "rate-card" | "summary"
      amountSource: t.amountSource, // "ga4_RatesLoaded" | "scrape" | null
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
    // Published on the UI frame (top) so it is where a console or a listener
    // would look, regardless of which frame the badge was clicked in.
    var rw = (state.frames && state.frames.ui && state.frames.ui.win) || window;
    try {
      rw.__blissPlanChoice = choice;
    } catch (e) {
      window.__blissPlanChoice = choice;
    }
    try {
      var Ctor = rw.CustomEvent || window.CustomEvent;
      rw.dispatchEvent(new Ctor("bliss:plan-selected", { detail: choice }));
    } catch (e) {
      /* ignore */
    }
    console.log("[bliss] plan selected", choice);
    // Session-level, so the Details block can show State A after the rate-card
    // trigger that recorded this has been unmounted. Shares t.confirmed's
    // minimal shape: the full `choice` above keeps the amounts for the record,
    // but nothing rendered reads them.
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
   * Where to insert the pill: immediately after the card's primary CTA.
   *
   * Returns the DIRECT CHILD of the card that contains the CTA, not the CTA
   * itself. Inserting next to the button would drop the pill inside whatever
   * flex row the button sits in, making it a sibling column rather than its own
   * line. Climbing to the card's own child list puts it in the card's block
   * flow, which is what "its own line" actually requires.
   */
  function findInsertionAnchor(card) {
    var p = (CONFIG.rateCards && CONFIG.rateCards.placement) || {};
    var el = null;
    if (p.ctaSelector) {
      try {
        el = card.querySelector(p.ctaSelector);
      } catch (e) {
        el = null;
      }
    }
    if (!el) {
      // Fallback: the last interactive element in the card, which on a rate
      // card is the Book now button. Our own pill cannot be matched here — it
      // lives behind a shadow root, so querySelectorAll cannot see into it.
      var interactive = card.querySelectorAll('button, [role="button"], a[href]');
      el = interactive.length ? interactive[interactive.length - 1] : null;
    }
    if (!el) return null;
    var node = el;
    while (node && node.parentNode !== card) node = node.parentNode;
    return node;
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
    // Both are inert on a block parent. They matter when the card is itself a
    // flex or grid container, where they force the pill onto its own line
    // instead of letting it be squeezed in as another column.
    hostEl.style.flexBasis = "100%";
    hostEl.style.gridColumn = "1 / -1";
  }

  function cardLabel(card) {
    var sel = CONFIG.rateCards.labelSelector;
    if (!sel) return null;
    var el = card.querySelector(sel);
    var text = el ? String(el.textContent || "").replace(/\s+/g, " ").trim() : "";
    return text ? text.slice(0, 80) : null;
  }

  function attachBadge(card) {
    if (card.hasAttribute(DECORATED_ATTR)) {
      // The attribute survives a re-render that replaced the card's children,
      // so confirm our node is still in there before trusting it.
      if (card.querySelector("[" + BADGE_ATTR + "]")) return;
      card.removeAttribute(DECORATED_ATTR);
    }
    var hostEl = (card.ownerDocument || document).createElement("div");
    hostEl.setAttribute(BADGE_ATTR, "");
    styleInlinePill(hostEl);
    hostEl.style.display = "none";
    var root = hostEl.attachShadow({ mode: "open" });

    // Sibling insertion mutates the card's child list, which a re-render will
    // discard. That is covered: the observer re-runs decorate, and the
    // DECORATED_ATTR guard plus the "is our node still in there" check make
    // re-insertion idempotent rather than duplicating.
    var anchor = findInsertionAnchor(card);
    if (anchor && anchor.parentNode === card) card.insertBefore(hostEl, anchor.nextSibling);
    else card.appendChild(hostEl);

    var t = {
      id: state.nextId++,
      kind: "rate-card",
      cardEl: card,
      hostEl: hostEl,
      root: root,
      label: cardLabel(card),
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

  /**
   * Decorates every same-origin frame that has cards, not just the first. That
   * removes the "which frame" guess entirely and copes with the frame not
   * existing yet when the script is first pasted.
   */
  function decorateRateCards() {
    var cfg = CONFIG.rateCards;
    if (!cfg || !cfg.cardSelector) return;
    var frames = (state.frames && state.frames.cards) || [];
    for (var f = 0; f < frames.length; f++) {
      var cards;
      try {
        cards = frames[f].doc.querySelectorAll(cfg.cardSelector);
      } catch (e) {
        console.warn("[bliss] CONFIG.rateCards.cardSelector is not a valid selector", e);
        return;
      }
      for (var i = 0; i < cards.length; i++) attachBadge(cards[i]);
    }
  }

  /** Drops triggers whose card the SPA has unmounted. */
  function pruneTriggers() {
    var kept = [];
    for (var i = 0; i < state.triggers.length; i++) {
      var t = state.triggers[i];
      // The Details block lives in host DOM like a rate card, so it is pruned
      // on the same rule: alive only while its own node is still mounted.
      var alive = t.kind === "details"
        ? t.hostEl.isConnected
        : t.cardEl && t.cardEl.isConnected && t.hostEl.isConnected;
      if (alive) {
        kept.push(t);
        continue;
      }
      if (t.hostEl && t.hostEl.parentNode) t.hostEl.parentNode.removeChild(t.hostEl);
      if (t.cardEl) {
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
  // PLACEMENT — summary trigger
  // -------------------------------------------------------------------------

  /**
   * The Details-step block, mounted INLINE directly beneath the "You'll pay
   * later based on your booking conditions" line.
   *
   * Replaces the floating corner pill entirely. Same approach as the rate-card
   * triggers: a normal block sibling in the host's own flow, nothing
   * positioned, so nothing can overlap host content. Inserted after the
   * anchor's top-level container within that container's parent, so it lands
   * in the card's block flow rather than inside whatever row the anchor sits
   * in — the same reasoning as findInsertionAnchor.
   */
  function ensureDetailsTrigger() {
    var cfg = CONFIG.detailsStep;
    if (!cfg || !cfg.anchorSelector) return;

    // Search every frame that could hold the step, not just the card frames:
    // Details renders after Rates, so no rate-item exists to mark its frame.
    var anchor = null;
    var frames = (state.frames && state.frames.all) || [];
    for (var f = 0; f < frames.length && !anchor; f++) {
      try {
        anchor = frames[f].doc.querySelector(cfg.anchorSelector);
      } catch (e) {
        anchor = null;
      }
    }

    var existing = null;
    for (var i = 0; i < state.triggers.length; i++) {
      if (state.triggers[i].kind === "details") existing = state.triggers[i];
    }

    if (!anchor) {
      // Not on the Details step. Drop any block left from a previous visit.
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
    // Orphan sweep. A host that is in the DOM but not in state.triggers is
    // never re-rendered, so it freezes on whatever markup it last had — a
    // deselected plan would keep showing State A forever. Nothing else reads
    // data-bliss-details, so this is the only thing standing between a stray
    // node and permanently stale UI.
    var tracked = existing && existing.hostEl;
    for (var d = 0; d < frames.length; d++) {
      var strays;
      try {
        strays = frames[d].doc.querySelectorAll("[data-bliss-details]");
      } catch (e) {
        continue;
      }
      for (var s = 0; s < strays.length; s++) {
        if (strays[s] !== tracked && strays[s].parentNode) strays[s].parentNode.removeChild(strays[s]);
      }
    }

    if (existing && existing.hostEl.isConnected) return;
    if (existing && existing.hostEl.parentNode) existing.hostEl.parentNode.removeChild(existing.hostEl);
    // Carry an open modal across the replacement, otherwise renderModal looks
    // up a trigger id that no longer exists and silently closes itself.
    var modalWasOnExisting = !!(existing && state.modal && state.modal.triggerId === existing.id);
    state.triggers = state.triggers.filter(function (x) {
      return x !== existing;
    });

    // Climb to the anchor's top-level container so the block joins the card's
    // block flow instead of the anchor's own row.
    var slot = anchor;
    while (slot.parentNode && slot.parentNode.parentNode && slot.parentNode !== slot.ownerDocument.body) {
      if (slot.parentNode.children.length > 1) break;
      slot = slot.parentNode;
    }

    var doc = anchor.ownerDocument;
    var anchorEl = anchor; // kept so the block can match its typography exactly
    var hostEl = doc.createElement("div");
    hostEl.setAttribute(BADGE_ATTR, "");
    hostEl.setAttribute("data-bliss-details", "");
    hostEl.style.display = "none";
    hostEl.style.width = "100%";
    hostEl.style.boxSizing = "border-box";
    hostEl.style.marginTop = (cfg.marginTopPx == null ? 10 : cfg.marginTopPx) + "px";
    hostEl.style.flexBasis = "100%";
    hostEl.style.gridColumn = "1 / -1";
    var root = hostEl.attachShadow({ mode: "open" });
    slot.parentNode.insertBefore(hostEl, slot.nextSibling);

    var newId = state.nextId++;
    if (modalWasOnExisting && state.modal) state.modal.triggerId = newId;
    state.triggers.push({
      id: newId,
      kind: "details",
      cardEl: null,
      anchorEl: anchorEl,
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

  // One-shot so a per-mutation sync cannot spam the console.
  var warnedTotalUnparsed = false;

  /** The tax-inclusive Total off the Details step, in cents. Basis for $Z. */
  function scrapeDetailsTotalCents() {
    var sel = CONFIG.detailsStep && CONFIG.detailsStep.totalSelector;
    if (!sel) return null;
    var frames = (state.frames && state.frames.all) || [];
    for (var i = 0; i < frames.length; i++) {
      var el = null;
      try {
        el = frames[i].doc.querySelector(sel);
      } catch (e) {
        el = null;
      }
      if (!el) continue;
      var cents = parseMoneyTextToCents(el.textContent);
      // A selector that resolves but yields no number is the label-vs-value
      // mistake. Silently returning null hides the whole block with no clue
      // why, which is exactly how that went unnoticed — so say it out loud.
      if (cents == null && !warnedTotalUnparsed) {
        warnedTotalUnparsed = true;
        console.warn(
          "[bliss] detailsStep.totalSelector matched an element with no parsable amount: " +
            JSON.stringify(String(el.textContent || "").trim().slice(0, 40)) +
            ". Is it the label rather than the value?"
        );
      }
      return cents;
    }
    return null;
  }

  function applyAmount(t) {
    if (t.kind === "details") {
      t.detailsTotalCents = scrapeDetailsTotalCents();
      // STEP-AWARE BASIS. On Details the modal is written against the
      // tax-inclusive Total plus the Bliss fee — the same basis the block's own
      // $Z teaser uses, so the two agree by construction. Falls back to
      // ecommerce.value only if the Total could not be read.
      t.amountCents =
        t.detailsTotalCents == null
          ? CONFIG.deriveAmountCents(state.dl)
          : Math.round(t.detailsTotalCents * (1 + BLISS_FEE_RATE));
      t.nightlyAmountCents = null;
      t.scrapedNightlyCents = null;
      t.currency = null;
      t.rateId = null;
      t.rateName = null;
      t.amountSource = t.amountCents == null ? null : "ecommerce.value";
      return;
    }
    var resolved = CONFIG.resolveCardAmount(t.cardEl, state.dl);
    // Independent of `resolved`: the trigger's per-night figure comes from the
    // card's displayed price, which the ga4 path never reads.
    t.scrapedNightlyCents = scrapeNightlyCents(t.cardEl);
    // STEP-AWARE BASIS. On Rates the modal is written against the PRE-TAX stay
    // total: the card's own displayed nightly price times nights, matching the
    // basis the rate-card teaser quotes. ga4's gross figure is used only as a
    // fallback when the scrape fails.
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
      if (t.kind === "rate-card") t.label = t.rateName || cardLabel(t.cardEl) || t.label;
      if (t.kind === "details") {
        // State A/B is driven by the session-level choice, not by this
        // trigger's own confirmation — the rate-card trigger that recorded it
        // no longer exists. Mirrored onto `confirmed` so the modal's existing
        // "Plan selected" cancel row renders unchanged.
        t.confirmed = state.planChoice;
        if (t.confirmed && !optionByFrequency(t.preview, t.confirmed.frequency)) t.confirmed = null;
        return;
      }
      if (t.confirmed) {
        // A changed cart or rate invalidates a previous confirmation.
        // Invalidate only when the CADENCE is no longer offered. A changed
        // amount is no longer grounds to drop the confirmation: the figure is
        // derived at render, so it simply follows the new basis.
        if (!optionByFrequency(t.preview, t.confirmed.frequency)) t.confirmed = null;
      }
    });
    if (state.modal) {
      var mt = triggerById(state.modal.triggerId);
      if (!mt) closeModal();
      else if (state.modal.selected != null && !optionByFrequency(mt.preview, state.modal.selected)) {
        // Repair only a selection that has become INVALID — a cadence the
        // merchant no longer offers, or one the dates no longer fit. A null
        // selection is deliberate (the guest deselected) and must survive:
        // repairing it to the default silently re-selected the plan they had
        // just cancelled, which re-armed the confirm button behind their back.
        state.modal.selected = defaultSelected(mt.preview);
      }
    }
  }

  /**
   * Theme follows the card frame. Re-sampled when that frame changes, so an
   * iframe that mounts after install does not leave badges wearing the top
   * frame's palette.
   */
  var themeWin = null;

  /**
   * The frame holding distributor content, which is what the theme should be
   * sampled from.
   *
   * frames.cards alone is not enough: it is defined by rate-item matching, so
   * it is empty on every step after Rates. On Details that fell through to
   * frames.ui — the top frame, a bare host shell with no font set — and the
   * sampler returned the initial serif, which is why the block rendered in
   * Times against a sans-serif page. Fall back to the frame that owns the
   * Details anchor before giving up and using the top frame.
   */
  function contentFrame() {
    var frames = (state.frames && state.frames.all) || [];
    if (state.frames && state.frames.cards && state.frames.cards[0]) return state.frames.cards[0];
    var sel = CONFIG.detailsStep && CONFIG.detailsStep.anchorSelector;
    if (sel) {
      for (var i = 0; i < frames.length; i++) {
        try {
          if (frames[i].doc.querySelector(sel)) return frames[i];
        } catch (e) {
          /* skip */
        }
      }
    }
    return state.frames ? state.frames.ui : null;
  }

  function ensureTheme() {
    var tf = contentFrame();
    var w = tf ? tf.win : window;
    if (state.theme && themeWin === w) return;
    themeWin = w;
    state.theme = sampleHostTheme(w);
  }

  function sync() {
    state.frames = resolveFrames();
    ensureHook();
    ensureTheme();
    state.dl = readDataLayer();
    ensureDetailsTrigger();
    decorateRateCards();
    pruneTriggers();
    recompute();
    renderAllTriggers();
    ensureObservers();
    if (state.modal) renderModal();
  }

  function refresh() {
    state.theme = null; // force a re-sample
    sync();
  }

  // ---- re-attach after SPA re-renders -------------------------------------
  // The distributor swaps whole step subtrees, which takes our badges with it.
  // Re-running sync is cheap because attachBadge is guarded by DECORATED_ATTR,
  // so a settled page does no work per mutation.
  //
  // One observer per document: the card frames, plus the UI frame so that the
  // iframe being inserted or replaced is itself seen. An observer is bound to
  // the document it was created against, so a frame navigation silently kills
  // it — hence also a load listener on every iframe element, and a prune pass
  // that drops observers whose document has gone.
  var moPending = false;
  var observers = []; // {doc, obs}
  var boundFrames = []; // iframe elements with a load listener

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

  function observeDoc(doc, win) {
    for (var i = 0; i < observers.length; i++) if (observers[i].doc === doc) return;
    if (!doc.body) return;
    var MO;
    try {
      MO = win.MutationObserver || window.MutationObserver;
    } catch (e) {
      MO = window.MutationObserver;
    }
    if (typeof MO !== "function") return;
    try {
      var obs = new MO(onMutation);
      obs.observe(doc.body, { childList: true, subtree: true });
      observers.push({ doc: doc, obs: obs });
    } catch (e) {
      /* ignore */
    }
  }

  function ensureObservers() {
    var frames = (state.frames && state.frames.all) || [];
    var i, j;
    for (i = 0; i < frames.length; i++) observeDoc(frames[i].doc, frames[i].win);

    // Drop observers whose document is no longer among the live frames.
    var keptObs = [];
    for (i = 0; i < observers.length; i++) {
      var live = false;
      for (j = 0; j < frames.length; j++) if (frames[j].doc === observers[i].doc) live = true;
      if (live) keptObs.push(observers[i]);
      else {
        try {
          observers[i].obs.disconnect();
        } catch (e) {
          /* ignore */
        }
      }
    }
    observers = keptObs;

    // A navigating iframe replaces its document, so watch for its load too.
    for (i = 0; i < frames.length; i++) {
      var iframes;
      try {
        iframes = frames[i].doc.querySelectorAll("iframe");
      } catch (e) {
        continue;
      }
      for (j = 0; j < iframes.length; j++) {
        if (boundFrames.indexOf(iframes[j]) !== -1) continue;
        try {
          iframes[j].addEventListener("load", onMutation);
          boundFrames.push(iframes[j]);
        } catch (e) {
          /* ignore */
        }
      }
    }
    boundFrames = boundFrames.filter(function (el) {
      return el.isConnected;
    });
  }

  function stopObserver() {
    for (var i = 0; i < observers.length; i++) {
      try {
        observers[i].obs.disconnect();
      } catch (e) {
        /* ignore */
      }
    }
    observers = [];
    for (var j = 0; j < boundFrames.length; j++) {
      try {
        boundFrames[j].removeEventListener("load", onMutation);
      } catch (e) {
        /* ignore */
      }
    }
    boundFrames = [];
  }

  // ---- subscribe to future dataLayer pushes -------------------------------
  // The distributor keeps pushing as the guest changes dates or rooms. Wrap
  // push, forward everything untouched, and re-sync on the next frame so a
  // burst of pushes collapses into one repaint.
  var pending = false;
  var originalPush = null;
  var dlRef = null;
  var hookedWin = null;

  /** Hooks the resolved data frame, re-hooking if that frame ever changes. */
  function ensureHook() {
    var f = state.frames && state.frames.data;
    var w = f ? f.win : null;
    if (!w) return;
    if (hookedWin === w && dlRef && dlRef.push !== originalPush) return;
    unhook();
    try {
      if (!w.dataLayer) w.dataLayer = [];
      dlRef = w.dataLayer;
    } catch (e) {
      dlRef = null;
      return;
    }
    hookedWin = w;
    originalPush = dlRef.push;
    dlRef.push = function () {
      var result = originalPush.apply(dlRef, arguments);
      if (!pending) {
        pending = true;
        schedule(function () {
          pending = false;
          try {
            refresh();
          } catch (e) {
            console.warn("[bliss] refresh failed", e);
          }
        });
      }
      return result;
    };
  }

  function unhook() {
    if (dlRef && originalPush) dlRef.push = originalPush;
    originalPush = null;
    dlRef = null;
    hookedWin = null;
  }

  // =========================================================================
  // BOOT
  //
  // Nothing renders until the merchant's plan rules have arrived. start() is
  // the only thing that touches the page, and boot() is its only caller.
  // =========================================================================

  var bailed = false;

  /** Refuses to run, once, with the reason. Never renders, never retries. */
  function bail(why) {
    if (bailed) return;
    bailed = true;
    console.warn("[bliss] overlay not started — " + why);
  }

  /**
   * Where the merchant slug and API base come from.
   *
   * Hosted: the script tag's own data attributes, read via
   * document.currentScript. A querySelector fallback covers the case where the
   * script was loaded in a way that leaves currentScript null (async/module
   * injection), by finding any script tag carrying the merchant attribute.
   *
   * Console paste: no script tag exists, so it falls back to
   * window.__blissOverlayConfig = { merchant, apiBase }. Note what does NOT
   * fall back — the RULES. Both paths fetch them identically; the only thing
   * the dev path substitutes is where the slug came from.
   */
  function readInstallConfig() {
    var el = CURRENT_SCRIPT;
    if (!el || !el.getAttribute || !el.getAttribute(MERCHANT_ATTR)) {
      try {
        el = document.querySelector("script[" + MERCHANT_ATTR + "]");
      } catch (e) {
        el = null;
      }
    }
    if (el && el.getAttribute && el.getAttribute(MERCHANT_ATTR)) {
      return {
        source: "script tag",
        merchant: String(el.getAttribute(MERCHANT_ATTR) || "").trim(),
        apiBase: String(el.getAttribute(API_ATTR) || "").trim() || DEFAULT_API_BASE,
      };
    }
    var g = null;
    try {
      g = window.__blissOverlayConfig || null;
    } catch (e) {
      g = null;
    }
    if (g && g.merchant) {
      return {
        source: "window.__blissOverlayConfig",
        merchant: String(g.merchant).trim(),
        apiBase: String(g.apiBase || "").trim() || DEFAULT_API_BASE,
      };
    }
    return { source: null, merchant: "", apiBase: DEFAULT_API_BASE };
  }

  /**
   * Builds CONFIG.rules from the API payload field by field, rather than
   * assigning the response wholesale: a missing field would otherwise arrive as
   * undefined and read as "no limit" inside previewEligibility. Returns null if
   * anything required is absent, which bails rather than guessing.
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
    if (!install.merchant) {
      bail(
        'no merchant slug. Add ' + MERCHANT_ATTR + '="<slug>" to the script tag, or for a ' +
          "console paste set window.__blissOverlayConfig = { merchant: \"<slug>\" } first."
      );
      return;
    }
    var url =
      install.apiBase.replace(/\/+$/, "") +
      "/api/v1/public/merchants/" +
      encodeURIComponent(install.merchant) +
      "/plan-rules";

    var request;
    try {
      // credentials omitted deliberately: the endpoint answers any origin with
      // Access-Control-Allow-Origin: *, which is incompatible with credentials.
      request = window.fetch(url, { credentials: "omit", cache: "no-store" });
    } catch (e) {
      bail("could not request " + url + " (" + e.message + ").");
      return;
    }

    request
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (payload) {
        if (!payload || payload.pmsType !== "mews") {
          bail(
            "merchant " + install.merchant + ' is on the "' +
              (payload ? payload.pmsType : "unknown") +
              '" rail, not "mews". This overlay only decorates a Mews booking engine.'
          );
          return;
        }
        var rules = rulesFromPayload(payload);
        if (!rules) {
          bail("plan rules payload was missing required fields. Nothing rendered.");
          return;
        }
        CONFIG.rules = rules;
        start(install, url);
      })
      .catch(function (e) {
        bail(
          "could not load plan rules from " + url + " (" + e.message + "). Nothing rendered: " +
            "running on stale or default rules would put wrong money on a live booking page."
        );
      });
  }

  function start(install, url) {

  refresh(); // resolves frames, hooks the data frame, decorates, observes

  var api = {
    refresh: refresh,
    destroy: function () {
      unhook();
      stopObserver();
      unbindKeydown();
      closeModal();
      state.triggers.forEach(function (t) {
        if (t.hostEl && t.hostEl.parentNode) t.hostEl.parentNode.removeChild(t.hostEl);
      });
      state.triggers = [];
      stripInjectedDom();
      var frames = collectFrames();
      for (var i = 0; i < frames.length; i++) {
        try {
          delete frames[i].win.__blissOverlay;
        } catch (e) {
          /* ignore */
        }
      }
    },
    open: function (triggerId) {
      openModal(triggerId == null ? (state.triggers[0] || {}).id : triggerId);
    },
    state: function () {
      return state;
    },
    frames: function () {
      return state.frames;
    },
    config: CONFIG,
    __unhook: unhook,
    __unobserve: stopObserver,
  };

  // Published on both this frame and the UI frame, so __blissOverlay answers
  // whichever context the console happens to be pointed at.
  (function installApi() {
    var targets = [window];
    var ui = state.frames && state.frames.ui && state.frames.ui.win;
    if (ui && targets.indexOf(ui) === -1) targets.push(ui);
    for (var i = 0; i < targets.length; i++) {
      try {
        targets[i].__blissOverlay = api;
      } catch (e) {
        /* ignore */
      }
    }
  })();

  // ---- install report ------------------------------------------------------
  // Frame resolution is the thing most likely to be wrong on a new property,
  // and it fails silently, so state it rather than leave it to be diagnosed.
  var cardFrameCount = state.frames.cards.length;
  var badgeCount = 0;
  for (var bi = 0; bi < state.triggers.length; bi++) {
    if (state.triggers[bi].kind === "rate-card") badgeCount++;
  }
  console.log(
    "[bliss] overlay installed. __blissOverlay.refresh() / .destroy() / .open() / .state() / .frames().\n" +
      "  merchant: " + install.merchant + " (slug read from " + install.source + ")\n" +
      "  plan rules: fetched from " + url + "\n" +
      "  frames reachable: " + state.frames.all.length +
      "  |  data frame is top: " + (state.frames.data === state.frames.all[0]) +
      "  |  dataLayer entries: " + ((dataLayerArray() || []).length) + "\n" +
      "  card frames: " + cardFrameCount + "  |  badges attached: " + badgeCount +
      "  |  UI frame is top: " + (state.frames.ui === state.frames.all[0]) + "\n" +
      "  Amount basis: rate cards = ga4_RatesLoaded x nights (tax-EXCLUSIVE); " +
      "summary = ecommerce.value."
  );
  if (!CONFIG.rateCards.cardSelector) {
    console.warn(
      "[bliss] Rates-step badges are INERT: CONFIG.rateCards.cardSelector is empty, so there is nothing " +
        "to attach to. Only the Summary trigger will appear."
    );
  } else if (cardFrameCount === 0) {
    console.warn(
      "[bliss] No frame matched cardSelector yet. Expected on any step other than Rates. If you ARE on " +
        "the Rates step, the card frame is probably cross-origin or sandboxed without allow-same-origin, " +
        "in which case it is invisible to this script and the overlay must be pasted into it directly."
    );
  }
  if ((dataLayerArray() || []).length === 0) {
    console.warn(
      "[bliss] No frame had a populated dataLayer. Amounts and dates will be null. If the top frame is " +
        "cross-origin from here, its dataLayer cannot be read and there is no way around that."
    );
  }
  } // end start()

  boot();
})();
