"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import Link from "next/link";
import {
  createBooking,
  devLogin,
  updateMerchant,
  DEFAULT_PLAN_RULES,
} from "@/lib/api";
import {
  previewEligibility,
  type PreviewReason,
} from "@/lib/eligibility";
import { calcInstallmentPlan, BLISS_FEE_RATE } from "@/lib/blissFee";
import {
  attemptCustomerLogin,
  createPlan,
  fetchPublicMerchant,
  type MerchantPolicies,
  type PublicPlanFrequency,
  type CreatePlanResponse,
} from "@/lib/publicApi";
import {
  refundCopy,
  dueDateCopy,
  failedPaymentCopy,
} from "@/components/consumer/PolicyDisclosure";
import { DEMO_HOTEL } from "@/lib/mewsDemo";

// Guest-facing sample booking site for the Marbrook House demo merchant.
// This is a neutral boutique-hotel funnel (room + rate -> your stay -> checkout)
// modeled on a SynXis-style direct booking flow. The whole payment flow happens
// on the checkout page: each payment method expands inline, and Book now creates
// the real booking (and, for installments, the plan via the existing backend
// engine) without leaving the page. The /pay hosted plan page stays intact as
// the backend source of truth but the checkout no longer routes to it.

// Default stay (editable): Fri Sep 11 to Sun Sep 13, 2026, 2 adults, 2 nights.
const DEFAULT_CHECKIN_ISO = "2026-09-11";
const DEFAULT_CHECKOUT_ISO = "2026-09-13";
const DEFAULT_ADULTS = 2;
const DEFAULT_CHILDREN = 0;

// New York lodging occupancy tax, charged on the room subtotal.
const OCCUPANCY_TAX_RATE = 0.08875;
// Flat house destination fee, per night.
const DESTINATION_FEE_PER_NIGHT_CENTS = 3000;

// --- Date helpers (local-time, no library) ---
function parseIso(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}
function toIso(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function nightsBetween(checkinIso: string, checkoutIso: string): number {
  const ms = parseIso(checkoutIso).getTime() - parseIso(checkinIso).getTime();
  return Math.max(0, Math.round(ms / 86400000));
}
function formatDateShort(iso: string): string {
  return parseIso(iso).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}
function formatDateLong(iso: string): string {
  return parseIso(iso).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
function stayRangeLabel(checkinIso: string, checkoutIso: string): string {
  return `${formatDateShort(checkinIso)} to ${formatDateLong(checkoutIso)}`;
}
// Numeric date, matching the dates-occupancy-header's "8/14/2026" in
// 02-categories.html.
function formatDateNumeric(iso: string): string {
  return parseIso(iso).toLocaleDateString("en-US");
}
// Short weekday ("Fri") plus the invariant text key the Distributor puts on it
// ("DayShortFriday"). The capture only evidences Friday and Sunday; the key
// pattern is DayShort + the full weekday name.
function weekdayShort(iso: string): string {
  return parseIso(iso).toLocaleDateString("en-US", { weekday: "short" });
}
function weekdayTextKey(iso: string): string {
  return `DayShort${parseIso(iso).toLocaleDateString("en-US", { weekday: "long" })}`;
}
function guestsLabel(adults: number, children: number): string {
  const a = `${adults} ${adults === 1 ? "adult" : "adults"}`;
  const c = `${children} ${children === 1 ? "child" : "children"}`;
  return `${a}, ${c}`;
}

// Per-night installment teaser for the rate cards: the nightly rate (pre-tax,
// pre-fee) divided by the REAL biweekly installment count for the selected
// dates, rounded to whole dollars. The count comes from previewEligibility (the
// shared cadence source of truth, mirroring the backend), so the teaser,
// checkout, and portal reconcile and update together when dates/nights change.
// Per-night basis reads apples-to-apples with the per-night sticker price.
// Mirrors mews-overlay.js:1642-1643: round the per-night figure to CENTS and
// format it with the currency-aware formatter (the overlay's money()), not to
// whole dollars. The overlay's moneyWhole() is dead code there and is not used
// by the teaser.
function perNightInstallmentLabel(nightlyCents: number, count: number): string {
  return formatUsd(Math.round(nightlyCents / count));
}

type Rate = {
  id: string;
  name: string;
  detail: string;
  nightlyCents: number;
  // This rate's OWN pre-discount nightly price, in integer cents. Present only
  // on a discounted rate; its absence is what says the rate is not discounted.
  // Never another rate's price — the Distributor strikes a rate against itself.
  strikeCents?: number;
  // Full cancellation policy shown in the checkout Policies block. Co-located
  // with the rate so the checkout reads it from the same selected rate that
  // drives the totals, with no separate rate-keyed lookup.
  cancellationPolicy: string;
};

type Pricing = {
  roomSubtotalCents: number;
  occupancyTaxCents: number;
  destinationFeeCents: number;
  totalCents: number;
  avgPerNightCents: number;
};

const RATES: Rate[] = [
  {
    id: "advance",
    name: "Advance purchase rate",
    detail: "Pay in full to lock in the lowest rate. Non-refundable.",
    nightlyCents: 38500,
    strikeCents: 45000,
    // Temporary alignment with the Bliss installment policy so the page never
    // shows two contradicting cancellation statements. Per-hotel policies come
    // later.
    cancellationPolicy: "Free cancellation up to 48 hours before check-in.",
  },
  {
    id: "flexible",
    name: "Best flexible rate",
    detail: "Free cancellation up to 48 hours before arrival.",
    nightlyCents: 42900,
    cancellationPolicy: "Free cancellation up to 48 hours before check-in.",
  },
];

// --- Room categories (step 2) ---------------------------------------------
// Marbrook had no category layer: the funnel sold one room. The Distributor's
// step 2 needs one, so it is created here.
//
// rateIds is what makes a category's from-price real rather than a magic
// number. TEMPORARY: both of Marbrook's rates apply to the single existing
// room, so both are listed against both categories rather than inventing
// per-category rate data. When real per-category rates exist, only this table
// changes.
type RoomCategory = {
  id: string;
  name: string;
  description: string;
  // One-line room spec, shown on the summary step.
  specs: string;
  sleeps: number;
  rateIds: string[];
  // Lowest nightlyCents among rateIds, in integer cents.
  fromPriceCents: number;
};

function lowestNightlyCents(rateIds: string[]): number {
  const cents = RATES.filter((r) => rateIds.includes(r.id)).map(
    (r) => r.nightlyCents,
  );
  return Math.min(...cents);
}

const ALL_RATE_IDS = RATES.map((r) => r.id);

const ROOM_CATEGORIES: RoomCategory[] = [
  {
    id: "king-terrace",
    // Marbrook's original single room. Name, description and specs are the
    // former ROOM constant's strings, verbatim.
    name: "King with Terrace",
    description:
      "A corner room with a private terrace overlooking the courtyard gardens. Soaking tub, walk-in rain shower, and a writing nook framed by tall windows.",
    specs: "1 King bed · Sleeps 2 · 260 sq ft",
    sleeps: 2,
    rateIds: ALL_RATE_IDS,
    fromPriceCents: lowestNightlyCents(ALL_RATE_IDS),
  },
  {
    id: "garden-double",
    name: "Garden Double",
    description:
      "A ground-floor room opening onto the walled garden. Two double beds, a wet room, and a seating corner by the window.",
    specs: "2 Double beds · Sleeps 4",
    sleeps: 4,
    rateIds: ALL_RATE_IDS,
    fromPriceCents: lowestNightlyCents(ALL_RATE_IDS),
  },
];

function ratesForCategory(category: RoomCategory | null): Rate[] {
  if (!category) return RATES;
  return RATES.filter((r) => category.rateIds.includes(r.id));
}

function formatUsd(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

// Demo-only card input formatters (no Stripe validation, display formatting).
// Card number: digits only, max 19, grouped in sets of 4 with spaces.
function formatCardNumber(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 19);
  return digits.replace(/(.{4})/g, "$1 ").trim();
}
// Expiration: digits only, max 4, slash after the first 2 (so "1228" -> "12/28").
// Dropping back to 2 digits removes the slash, so backspace works naturally.
function formatCardExp(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 4);
  return digits.length <= 2 ? digits : `${digits.slice(0, 2)}/${digits.slice(2)}`;
}
// CVV: digits only, max 4.
function formatCvv(value: string): string {
  return value.replace(/\D/g, "").slice(0, 4);
}

// previewEligibility's rules arg, whose type lib/eligibility does not export.
type PlanRulesArg = Parameters<typeof previewEligibility>[3];

// The Marbrook equivalent of an overlay trigger's `t.preview`: one plan preview
// per rate card, carrying the per-payment figures the overlay's options already
// have. Teaser and modal both read it, so they cannot drift.
type TeaserOption = {
  frequency: PublicPlanFrequency;
  numPayments: number;
  dueDates: string[];
  recommended: boolean;
  perPaymentCents: number;
  finalPaymentCents: number;
};
type TeaserPreview = {
  eligible: boolean;
  reason: PreviewReason;
  depositAmountCents: number;
  amountCents: number;
  options: TeaserOption[];
};

function buildTeaserPreview(
  today: Date,
  checkinIso: string,
  amountCents: number,
  rules: PlanRulesArg,
): TeaserPreview {
  const preview = previewEligibility(today, parseIso(checkinIso), amountCents, rules);
  return {
    eligible: preview.eligible,
    reason: preview.reason,
    depositAmountCents: preview.depositAmountCents,
    amountCents,
    options: preview.options.map((o) => {
      const calc = calcInstallmentPlan({
        baseCents: amountCents,
        numPayments: o.numPayments,
      });
      return {
        frequency: o.frequency as PublicPlanFrequency,
        numPayments: o.numPayments,
        dueDates: o.dueDates,
        recommended: o.recommended,
        perPaymentCents: calc.perPaymentCents,
        finalPaymentCents: calc.finalPaymentCents,
      };
    }),
  };
}

// mews-overlay.js:1590-1596. openModal seeds state.modal.selected with this
// (mews-overlay.js:1920), so the modal never opens with nothing selected.
function defaultSelected(p: TeaserPreview): PublicPlanFrequency | null {
  if (!p.options.length) return null;
  for (const o of p.options) if (o.recommended) return o.frequency;
  return p.options[0]!.frequency;
}

// mews-overlay.js:606-612. Tax-INCLUSIVE, unlike the rate-card figure, because
// it derives from the summary Total rather than a pre-tax nightly price. That
// difference is why this block's supporting line says only "No credit check".
function summaryPerNightCents(
  totalCents: number,
  nights: number,
  numPayments: number,
): number | null {
  if (!totalCents || totalCents <= 0) return null;
  if (!nights || nights <= 0) return null;
  if (!numPayments || numPayments <= 0) return null;
  const withFee = Math.round(totalCents * (1 + BLISS_FEE_RATE));
  return Math.round(withFee / nights / numPayments);
}

// mews-overlay.js:1615-1621 — monthly if offered, else the option with the
// smallest per-payment figure.
function fallbackOption(p: TeaserPreview): TeaserOption | null {
  if (!p.options.length) return null;
  const monthly = p.options.find((o) => o.frequency === "monthly");
  if (monthly) return monthly;
  return p.options.reduce((best, o) =>
    o.perPaymentCents < best.perPaymentCents ? o : best,
  );
}

// mews-overlay.js:1635-1641 — biweekly if offered, else the option with the
// most payments. This is what makes "starting at" truthful.
function spreadOption(p: TeaserPreview): TeaserOption | null {
  if (!p.options.length) return null;
  const biweekly = p.options.find((o) => o.frequency === "biweekly");
  if (biweekly) return biweekly;
  return p.options.reduce((best, o) =>
    o.numPayments > best.numPayments ? o : best,
  );
}

// Verbatim from mews-overlay.js:1265-1273.
const REASON_COPY: Record<PreviewReason, string> = {
  ok: "",
  too_close: "This stay is too soon to spread into a plan.",
  too_far: "This stay is too far out for a plan right now.",
  amount_too_low: "This stay is below the minimum for a payment plan.",
  amount_too_high: "This stay is above the maximum for a payment plan.",
  deposit_too_high:
    "The deposit covers the whole stay, so there is nothing left to spread.",
  no_plan_fits: "No plan fits between today and check-in.",
  invalid_input: "Pick your dates to see payment plan options.",
};

// mews-overlay.js:1259-1263.
function shortDate(iso: string): string {
  return parseIso(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

declare global {
  interface Window {
    dataLayer?: unknown[];
  }
}

// Appends one event to the GTM-style dataLayer, mirroring what the Mews
// distributor emits so the Bliss overlay can read this funnel unmodified.
//
// Append-only by contract. The overlay wraps dataLayer.push to re-sync on every
// event and walks the array backwards taking the LAST match per event name, so
// the array is never reassigned, spliced or reordered here — doing any of those
// would drop the overlay's hook or hide earlier events from it.
function pushDataLayer(event: Record<string, unknown>): void {
  if (typeof window === "undefined") return;
  // Only create it if absent. An existing array may already carry a wrapped
  // push (the overlay's) plus prior events; reassigning would discard both.
  if (!window.dataLayer) window.dataLayer = [];
  window.dataLayer.push(event);
}

// Gross nightly price in major units: net rate + occupancy tax + destination
// fee, rounded to cents.
//
// This DELIBERATELY differs from the figure the rate card prints. The card
// shows tax-exclusive `nightlyCents`; the feed carries gross. That split is not
// an inconsistency to fix — it mirrors the Mews distributor, where
// ga4_RatesLoaded carries a gross tax-and-fee-inclusive price while the card
// prints a tax-exclusive one, and it is the divergence the overlay's
// rate-card-versus-modal basis handling exists to cope with.
function grossNightly(nightlyCents: number): number {
  const grossCents =
    nightlyCents * OCCUPANCY_TAX_RATE + nightlyCents + DESTINATION_FEE_PER_NIGHT_CENTS;
  return Math.round(grossCents) / 100;
}

// --- Mews Distributor step machine ----------------------------------------
// Five steps, keyed exactly as the hosted Distributor keys them (see
// reference/distributor/SPEC.md section 1.4). Note step 5's key is "checkout",
// not "details", while its visible name is "Details" — matching on the key is
// what SPEC says to do, so the key is what we store.
type Step = "dates" | "categories" | "rates" | "summary" | "checkout";

type StepDescriptor = {
  key: Step;
  // 1-5, rendered in the numbered badge and in the "N of 5" control.
  number: number;
  name: string;
  // Locale-invariant copy key the Distributor puts on the step label span.
  textKey: string;
  ariaLabel: string;
  // The view container's data-test-id for this step. Deliberately NOT
  // `${key}-view`: step 2's key is "categories" but its view id is "rooms-view".
  viewId: string;
};

const STEPS: readonly StepDescriptor[] = [
  {
    key: "dates",
    number: 1,
    name: "Dates",
    textKey: "DatePlural",
    ariaLabel: "Link to Dates",
    viewId: "dates-view",
  },
  {
    key: "categories",
    number: 2,
    name: "Categories",
    textKey: "Categories",
    ariaLabel: "Link to Categories",
    viewId: "rooms-view",
  },
  {
    key: "rates",
    number: 3,
    name: "Rates",
    textKey: "RatePlural",
    ariaLabel: "Link to Rates",
    viewId: "rates-view",
  },
  {
    key: "summary",
    number: 4,
    name: "Summary",
    textKey: "Summary",
    ariaLabel: "Link to Summary",
    viewId: "summary-view",
  },
  {
    key: "checkout",
    number: 5,
    name: "Details",
    textKey: "DetailPlural",
    ariaLabel: "Link to Details",
    viewId: "checkout-view",
  },
] as const;

function stepDescriptor(step: Step): StepDescriptor {
  return STEPS.find((s) => s.key === step) ?? STEPS[0]!;
}

type PaymentMethod = "card" | "bliss";

type BookedState =
  | { method: "card" }
  | { method: "bliss"; plan: CreatePlanResponse };

// Card field values + setters, shared by both payment-method expansions.
type CardFieldState = {
  cardNumber: string;
  setCardNumber: (v: string) => void;
  cardExp: string;
  setCardExp: (v: string) => void;
  cardCvv: string;
  setCardCvv: (v: string) => void;
  cardName: string;
  setCardName: (v: string) => void;
};

export default function MarbrookHousePage() {
  // Opens on Dates, step 1, as the real Distributor does.
  const [step, setStep] = useState<Step>("dates");
  const [rateId, setRateId] = useState<string | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(
    null,
  );
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("card");
  const [frequency, setFrequency] = useState<PublicPlanFrequency>("biweekly");

  // Editable stay: dates + guests. Everything downstream (nights, subtotal,
  // tax, destination fee, total, teasers, schedule) derives from these.
  const [checkinIso, setCheckinIso] = useState(DEFAULT_CHECKIN_ISO);
  const [checkoutIso, setCheckoutIso] = useState(DEFAULT_CHECKOUT_ISO);
  const [adults, setAdults] = useState(DEFAULT_ADULTS);
  const [children, setChildren] = useState(DEFAULT_CHILDREN);
  const nights = nightsBetween(checkinIso, checkoutIso);

  // Contact info. Intentionally NOT prefilled: every booking must carry the
  // guest's own name and email so the plan binds to their customer record and
  // signs them into the portal. A shared default identity (the old
  // "Ava Mercer / ava@example.com") collided every booking onto one customer.
  const [prefix, setPrefix] = useState("Ms");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [addressLine1, setAddressLine1] = useState("");
  const [addressCity, setAddressCity] = useState("");
  const [addressState, setAddressState] = useState("");
  const [addressZip, setAddressZip] = useState("");

  // Card fields (demo only). One shared set; only the selected option's
  // expansion renders them, so a single source serves both payment methods.
  const [cardNumber, setCardNumber] = useState("");
  const [cardExp, setCardExp] = useState("");
  const [cardCvv, setCardCvv] = useState("");
  // Name on card defaults to the contact name and follows it until the guest
  // edits it directly.
  const [cardName, setCardName] = useState("");
  const [cardNameTouched, setCardNameTouched] = useState(false);
  const effectiveCardName = cardNameTouched
    ? cardName
    : `${firstName} ${lastName}`.trim();

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set once Book now completes. Drives the inline confirmation; no /pay nav.
  const [booked, setBooked] = useState<BookedState | null>(null);

  // The merchant's saved plan rules (eligibility + policy), read once from the
  // public merchants endpoint and shared by the schedule preview and the Bliss
  // plan-policy block. Falls back to DEFAULT_PLAN_RULES until loaded / on error
  // so SSR and the offline case still render. MerchantPolicies is a structural
  // superset of PlanRules, so it feeds previewEligibility directly.
  const [policies, setPolicies] = useState<MerchantPolicies | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchPublicMerchant(DEMO_HOTEL.slug)
      .then((m) => {
        if (!cancelled && m) setPolicies(m.policies);
      })
      .catch(() => {
        // leave policies null -> DEFAULT_PLAN_RULES fallback
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const planRules = policies ?? DEFAULT_PLAN_RULES;

  const rate = useMemo(
    () => RATES.find((r) => r.id === rateId) ?? null,
    [rateId],
  );

  const selectedCategory = useMemo(
    () => ROOM_CATEGORIES.find((c) => c.id === selectedCategoryId) ?? null,
    [selectedCategoryId],
  );
  // Rates the rates step may offer. Falls back to every rate when no category
  // is selected, so reaching step 3 straight from the stepper still shows them.
  const availableRates = useMemo(
    () => ratesForCategory(selectedCategory),
    [selectedCategory],
  );
  // One plan preview per rate card — the Marbrook equivalent of each overlay
  // trigger carrying its own `t.preview`. Basis is the rate's own pre-tax room
  // subtotal, matching the "Pre-tax" fine print the teaser and modal show.
  const previewByRateId = useMemo<Record<string, TeaserPreview>>(() => {
    const today = new Date();
    const out: Record<string, TeaserPreview> = {};
    for (const r of RATES) {
      out[r.id] = buildTeaserPreview(
        today,
        checkinIso,
        r.nightlyCents * nights,
        planRules,
      );
    }
    return out;
  }, [checkinIso, nights, planRules]);

  // The one resolved category every downstream step reads: the rates heading,
  // the summary, the sidebar, checkout, the confirmation, and the booking
  // written to the backend. Reaching a later step straight from the stepper
  // leaves none selected, so the first one stands in.
  const activeCategory = selectedCategory ?? ROOM_CATEGORIES[0]!;


  const pricing = useMemo(() => {
    if (!rate || nights <= 0) return null;
    const roomSubtotalCents = rate.nightlyCents * nights;
    const occupancyTaxCents = Math.round(roomSubtotalCents * OCCUPANCY_TAX_RATE);
    const destinationFeeCents = DESTINATION_FEE_PER_NIGHT_CENTS * nights;
    const totalCents = roomSubtotalCents + occupancyTaxCents + destinationFeeCents;
    return {
      roomSubtotalCents,
      occupancyTaxCents,
      destinationFeeCents,
      totalCents,
      avgPerNightCents: Math.round(totalCents / nights),
    };
  }, [rate, nights]);

  // The details block's basis is the tax-inclusive total, not a pre-tax
  // nightly price (mews-overlay.js:595-601).
  const checkoutPreview = useMemo<TeaserPreview | null>(() => {
    if (!pricing) return null;
    return buildTeaserPreview(new Date(), checkinIso, pricing.totalCents, planRules);
  }, [pricing, checkinIso, planRules]);

  // --- Mews distributor dataLayer feed -------------------------------------
  // Emits the four events the Bliss overlay reads. Kept as effects rather than
  // folded into the click handlers so each event fires from the state it
  // describes, after that state has settled.

  // Rates shown to the guest. Keyed on step so it fires on mount and again on
  // every re-entry to the rates step, matching the distributor's behaviour of
  // re-emitting when the Rates step is displayed. `name` passes through
  // untouched: the overlay matches a card to its rate by substring of the
  // card's visible label, so any reformatting here breaks that match.
  useEffect(() => {
    if (step !== "rates") return;
    pushDataLayer({
      event: "ga4_RatesLoaded",
      rates: RATES.map((r) => ({
        id: r.id,
        name: r.name,
        price: grossNightly(r.nightlyCents),
        currency: "USD",
      })),
    });
  }, [step]);

  // Stay dates, start then end as two separate pushes. This fires on mount as
  // well as on change, which is required rather than incidental: the demo ships
  // with a preset stay, and the overlay derives nights from both events — with
  // either missing, nights resolves null and every per-night figure is
  // suppressed. Values stay in "YYYY-MM-DD"; the overlay parses them as local
  // dates.
  useEffect(() => {
    pushDataLayer({ event: "distributorStartDateSelected", startDate: checkinIso });
    pushDataLayer({ event: "distributorEndDateSelected", endDate: checkoutIso });
  }, [checkinIso, checkoutIso]);

  // Cart contents once a rate is chosen. Deliberately NOT fired from
  // selectRate: pricing is a useMemo over [rate, nights] and has not recomputed
  // for the newly selected rate at the moment that handler runs, so firing
  // there would publish the previous rate's total.
  useEffect(() => {
    if (!rate || !pricing) return;
    pushDataLayer({
      event: "add_to_cart",
      ecommerce: {
        value: pricing.totalCents / 100,
        currency: "USD",
        items: [{ item_name: rate.name, item_variant: rate.detail }],
      },
    });
  }, [rateId, pricing, rate]);


  function selectRate(id: string) {
    setRateId(id);
    setStep("summary");
    window.scrollTo({ top: 0 });
  }

  function goToCheckout() {
    setStep("checkout");
    window.scrollTo({ top: 0 });
  }

  function onBookNow() {
    // Require the guest's own identity — no shared default to fall back on.
    if (firstName.trim() === "" || lastName.trim() === "") {
      setError("Enter the guest's first and last name to complete the booking.");
      window.scrollTo({ top: 0 });
      return;
    }
    if (email.trim() === "") {
      setError("Enter the guest's email to complete the booking.");
      window.scrollTo({ top: 0 });
      return;
    }
    setError(null);
    if (paymentMethod === "bliss") void bookWithPlan();
    else void bookWithCard();
  }

  // Find-or-create the Marbrook merchant (dev-login) and create the booking.
  // Shared by both payment methods.
  async function provisionBooking() {
    if (!rate || !pricing) throw new Error("missing selection");
    const merchant = await devLogin(DEMO_HOTEL.email);
    await updateMerchant({
      businessName: DEMO_HOTEL.businessName,
      businessType: DEMO_HOTEL.businessType,
      addressLine1: DEMO_HOTEL.addressLine1,
      addressCity: DEMO_HOTEL.addressCity,
      addressState: DEMO_HOTEL.addressState,
      addressZip: DEMO_HOTEL.addressZip,
    });
    const guestName = `${firstName} ${lastName}`.trim();
    const booking = await createBooking({
      serviceName: `${activeCategory.name} · ${rate.name}`,
      serviceDescription: `${nights} nights · ${stayRangeLabel(checkinIso, checkoutIso)} · ${guestsLabel(adults, children)}`,
      totalAmountCents: pricing.totalCents,
      appointmentDate: checkinIso,
      customerNameHint: guestName.length > 0 ? guestName : undefined,
      customerEmailHint: email.trim().length > 0 ? email.trim() : undefined,
    });
    return { merchant, booking };
  }

  // Installments path. Creates the plan through the existing backend engine
  // (the same /api/v1/public/plans call the old Continue -> /pay step used),
  // then shows an inline confirmation. No route change.
  async function bookWithPlan() {
    setSubmitting(true);
    setError(null);
    try {
      const { merchant, booking } = await provisionBooking();
      const digits = cardNumber.replace(/\D/g, "");
      const [mm, yy] = cardExp.split("/").map((s) => s.trim());
      const res = await createPlan({
        merchantSlug: merchant.slug,
        bookingToken: booking.bookingToken,
        customerEmail: email.trim(),
        customerFirstName: firstName.trim() || undefined,
        customerLastName: lastName.trim() || undefined,
        frequency,
        paymentMethodId: "pm_card_visa",
        demoCardLastFour: digits.slice(-4) || "4242",
        demoCardExpMonth: mm ? Number(mm) : 12,
        demoCardExpYear: yy ? 2000 + Number(yy) : 2030,
        demoCardBrand: "visa",
      });
      if (!res.ok) {
        setError(res.error.message);
        setSubmitting(false);
        return;
      }
      // Sign this guest into their portal so /account reflects the booking's
      // guest (not a stale session). The customer was just created by createPlan;
      // demo login resolves by email and ignores the password. A login hiccup
      // shouldn't block the confirmation, so failures are swallowed.
      const guestEmail = email.trim();
      if (guestEmail) {
        try {
          await attemptCustomerLogin({ email: guestEmail, password: "demo" });
        } catch {
          // non-fatal: guest can still sign in from the portal
        }
      }
      setBooked({ method: "bliss", plan: res.data });
      setSubmitting(false);
      window.scrollTo({ top: 0 });
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not complete your booking. Please try again.",
      );
      setSubmitting(false);
    }
  }

  // Full-balance card path. Demo only: creates the booking and confirms; there
  // is no separate full-charge engine in this build.
  async function bookWithCard() {
    setSubmitting(true);
    setError(null);
    try {
      await provisionBooking();
      setBooked({ method: "card" });
      setSubmitting(false);
      window.scrollTo({ top: 0 });
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not complete your booking. Please try again.",
      );
      setSubmitting(false);
    }
  }

  const contentStep =
    step === "rates" || step === "summary" || step === "checkout";

  return (
    <DistributorShell step={step} onSelectStep={setStep}>
      {step === "dates" ? (
        <DatesView
          checkinIso={checkinIso}
          checkoutIso={checkoutIso}
          adults={adults}
          guestChildren={children}
          onChangeRange={(ci, co) => {
            setCheckinIso(ci);
            setCheckoutIso(co);
          }}
          onChangeGuests={(a, c) => {
            setAdults(a);
            setChildren(c);
          }}
          onNext={() => {
            setStep("categories");
            window.scrollTo({ top: 0 });
          }}
        />
      ) : null}

      {step === "categories" ? (
        <RoomsView
          checkinIso={checkinIso}
          checkoutIso={checkoutIso}
          nights={nights}
          adults={adults}
          guestChildren={children}
          onEditStay={() => {
            setStep("dates");
            window.scrollTo({ top: 0 });
          }}
          onSelectCategory={(id) => {
            setSelectedCategoryId(id);
            setStep("rates");
            window.scrollTo({ top: 0 });
          }}
        />
      ) : null}

      {/* The view container holds step content only. BookingBar now lives in
          DatesView, where the Distributor puts it; SPEC 1.6 also reuses it as
          [data-test-id="dates-occupancy-header"] on steps 2 and 3, which is not
          built yet. */}
      {contentStep ? (
        <>
      <div className="mx-auto max-w-7xl px-6 py-8">
        <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-[1fr_320px]">
          <div className="min-w-0">
            {step === "rates" ? (
              <RatesView
                category={activeCategory}
                rates={availableRates}
                selectedRateId={rateId}
                previewByRateId={previewByRateId}
                checkinIso={checkinIso}
                checkoutIso={checkoutIso}
                nights={nights}
                adults={adults}
                guestChildren={children}
                onEditStay={() => {
                  setStep("dates");
                  window.scrollTo({ top: 0 });
                }}
                onSelectRate={selectRate}
              />
            ) : null}

            {step === "summary" && rate && pricing ? (
              <SummaryView
                category={activeCategory}
                rate={rate}
                pricing={pricing}
                nights={nights}
                checkinIso={checkinIso}
                checkoutIso={checkoutIso}
                adults={adults}
                guestChildren={children}
                onBack={() => setStep("rates")}
                onCheckout={goToCheckout}
              />
            ) : null}

            {step === "checkout" && rate && pricing ? (
              booked ? (
                <BookedPanel
                  booked={booked}
                  category={activeCategory}
                  rate={rate}
                  stayLabel={stayRangeLabel(checkinIso, checkoutIso)}
                />
              ) : (
                <CheckoutStep
                  category={activeCategory}
                  bookingTotalCents={pricing.totalCents}
                  pricing={pricing}
                  nights={nights}
                  checkinIso={checkinIso}
                  checkoutPreview={checkoutPreview}
                  prefix={prefix}
                  setPrefix={setPrefix}
                  firstName={firstName}
                  setFirstName={setFirstName}
                  lastName={lastName}
                  setLastName={setLastName}
                  phone={phone}
                  setPhone={setPhone}
                  email={email}
                  setEmail={setEmail}
                  addressLine1={addressLine1}
                  setAddressLine1={setAddressLine1}
                  addressCity={addressCity}
                  setAddressCity={setAddressCity}
                  addressState={addressState}
                  setAddressState={setAddressState}
                  addressZip={addressZip}
                  setAddressZip={setAddressZip}
                  rate={rate}
                  paymentMethod={paymentMethod}
                  setPaymentMethod={setPaymentMethod}
                  setFrequency={setFrequency}
                  policies={policies}

                  cardFields={{
                    cardNumber,
                    setCardNumber,
                    cardExp,
                    setCardExp,
                    cardCvv,
                    setCardCvv,
                    cardName: effectiveCardName,
                    setCardName: (v) => {
                      setCardNameTouched(true);
                      setCardName(v);
                    },
                  }}
                  onBack={() => setStep("summary")}
                  onBookNow={onBookNow}
                  submitting={submitting}
                  error={error}
                />
              )
            ) : null}
          </div>

          {/* Persistent price-details / cart panel. */}
          <aside className="lg:sticky lg:top-6 lg:self-start">
            <PricePanel
              category={activeCategory}
              rate={rate}
              pricing={pricing}
              nights={nights}
              checkinIso={checkinIso}
              checkoutIso={checkoutIso}
              adults={adults}
              guestChildren={children}
            />
          </aside>
        </div>
      </div>
        </>
      ) : null}
    </DistributorShell>
  );
}

// --- Mews Distributor shell ------------------------------------------------
// Structural port of reference/distributor/SPEC.md section 1: the chrome that
// is byte-identical on all five Distributor steps, plus the single swappable
// view container.
//
// Class-name policy, per SPEC section 6.4: the Distributor's generated
// styled-components classes (`Stack-sc-261eb2-0 cVHJkl` and friends) are
// build-versioned and explicitly NOT usable as selectors, so none of them are
// reproduced here. Every structural hook is a `data-test-*` attribute, a stable
// DOM id, or an ARIA role — the tiers SPEC section 6.4 ranks as durable — and
// the classes below are plain semantic names carrying the styling only.

function DistributorShell({
  step,
  onSelectStep,
  children,
}: {
  step: Step;
  onSelectStep: (step: Step) => void;
  children: React.ReactNode;
}) {
  const current = stepDescriptor(step);
  return (
    <div
      id="distributor"
      className="distributor min-h-screen bg-white text-[#23262e] font-sans"
    >
      <div data-mds-element="true" className="distributor-app-canvas flex min-h-screen flex-col">
        <SkipLinks />

        {/* The Distributor also carries width="100%" here, offset="152" on
            <main>, and height="100%" on the live region. Those are styled-
            components props leaking onto the DOM rather than selector hooks
            (SPEC 1.1 lists none of them), and React's typings reject them on
            div/main, so they are dropped. */}
        <div data-mds-element="true" className="distributor-header">
          <DistributorToolbar />
          <DistributorStepper step={step} onSelectStep={onSelectStep} />
        </div>

        <main
          id="main"
          data-mds-element="true"
          className={`distributor-app-view flex-1 ${
            step === "dates" ? "" : "bg-[#F0F0F0]"
          }`}
        >
          <div data-mds-element="true">
            <div data-mds-element="true" className="distributor-transition">
              <div
                aria-busy="false"
                data-mds-element="true"
                className="distributor-app-content"
              >
                <div
                  aria-live="assertive"
                  data-mds-element="true"
                  className="distributor-live-region"
                />
                <div className="distributor-view-wrapper" data-mds-element="true">
                  <div data-mds-element="true" className="distributor-transition-inner">
                    {/* Outgoing transition slot. Empty in every capture; kept so
                        the two-sibling View pattern SPEC 1.5 documents holds. */}
                    <div aria-live="assertive" className="distributor-view" />
                    <div aria-busy="false" className="distributor-view">
                      {/* The one element whose data-test-id changes with the
                          step. SPEC 1.5: select via [data-test-id$="-view"]. */}
                      <div
                        data-test-id={current.viewId}
                        role="region"
                        data-mds-element="true"
                        className="distributor-view-content"
                      >
                        {children}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </main>

        <div data-mds-element="true" />
        <div id="portal-container" />
      </div>
    </div>
  );
}

function SkipLinks() {
  return (
    <div data-mds-element="true" className="distributor-skip-links sr-only">
      <div data-mds-element="true">
        <span data-test-textkey="SkipTo" data-non-sensitive="true">
          Skip to:
        </span>
      </div>
      <ol data-mds-element="true">
        <li>
          <a href="#toolbar" data-mds-element="true">
            <span data-test-textkey="Toolbar" data-non-sensitive="true">
              Toolbar
            </span>
          </a>
        </li>
        <li>
          <a href="#navigation" data-mds-element="true">
            <span data-test-textkey="SiteNavigation" data-non-sensitive="true">
              Site navigation
            </span>
          </a>
        </li>
        <li>
          <a href="#main" data-mds-element="true">
            <span data-test-textkey="MainContent" data-non-sensitive="true">
              Main content
            </span>
          </a>
        </li>
      </ol>
    </div>
  );
}

// Property identity on the left, language + currency selects on the right.
// SPEC 1.3 notes the Distributor duplicates each selector's value three ways;
// the one it calls the cleanest read, data-test-display-value, is reproduced on
// the control itself.
const LANGUAGES = ["English (United States)", "Deutsch", "Français", "Español"];
const CURRENCIES = ["USD", "EUR", "GBP", "CAD"];

function DistributorToolbar() {
  const [language, setLanguage] = useState(LANGUAGES[0]!);
  const [currency, setCurrency] = useState(CURRENCIES[0]!);
  return (
    <div
      role="banner"
      id="toolbar"
      data-mds-element="true"
      className="distributor-toolbar border-b border-[#23262e]/10 bg-white"
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-6 py-4">
        <div data-mds-element="true" className="flex items-center gap-3">
          <div
            data-mds-element="true"
            className="distributor-property-logo flex items-center text-[#23262e]"
            aria-hidden="true"
          >
            <span
              className="text-4xl leading-none"
              style={{ fontFamily: "var(--font-caveat), cursive", fontWeight: 700 }}
            >
              MH
            </span>
          </div>
          <div
            data-mds-element="true"
            className="distributor-property-name font-serif text-xl leading-tight tracking-tight text-[#23262e]"
          >
            {DEMO_HOTEL.businessName}
          </div>
        </div>

        <div data-mds-element="true" className="flex items-center gap-3">
          <ToolbarSelect
            fieldName="languageSelector"
            testId="language-selector"
            controlId="languageSelector"
            ariaLabel="Select language"
            labelTextKey="SelectLanguage"
            labelText="Select language"
            options={LANGUAGES}
            value={language}
            onChange={setLanguage}
          />
          <ToolbarSelect
            fieldName="currencySelect"
            testId="currency-selector"
            controlId="currencySelect"
            ariaLabel="Select currency"
            labelTextKey="SelectCurrency"
            labelText="Select currency"
            options={CURRENCIES}
            value={currency}
            onChange={setCurrency}
          />
        </div>
      </div>
    </div>
  );
}

function ToolbarSelect({
  fieldName,
  testId,
  controlId,
  ariaLabel,
  labelTextKey,
  labelText,
  options,
  value,
  onChange,
}: {
  fieldName: string;
  testId: string;
  controlId: string;
  ariaLabel: string;
  labelTextKey: string;
  labelText: string;
  options: readonly string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="distributor-field" data-test-field={fieldName} data-mds-element="true">
      <div data-mds-element="true" className="distributor-field-input">
        <select
          id={controlId}
          data-test-id={testId}
          aria-label={ariaLabel}
          data-test-display-value={value}
          data-mds-element="true"
          className="distributor-combo cursor-pointer rounded-[6px] border border-[#23262e]/15 bg-white px-3 py-1.5 text-sm text-[#23262e]"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </div>
      <span
        aria-hidden="true"
        id={`${controlId}-sr-only-label`}
        data-mds-element="true"
        className="sr-only"
      >
        <span>{value}</span>
        <span>
          ,
          <span data-test-textkey={labelTextKey} data-non-sensitive="true">
            {labelText}
          </span>
        </span>
      </span>
    </div>
  );
}

// SPEC 1.4: the captured stepper is collapsed, and in that state exactly one
// StepWrapper and one [data-test-step] exist — the current step only. The
// toggle's aria-expanded is what flips that, so expanding renders all five.
// [data-test-step] stays on the current step alone in both states, so the
// invariant an overlay reads progress from holds either way.
function DistributorStepper({
  step,
  onSelectStep,
}: {
  step: Step;
  onSelectStep: (step: Step) => void;
}) {
  const current = stepDescriptor(step);
  // All five steps render so the connector and the completed/future states have
  // something to draw. data-test-step still sits on the current step only,
  // preserving the invariant SPEC 1.4 documents.
  return (
    <nav
      id="navigation"
      aria-label="Progress"
      className="distributor-navbar border-b border-[#E6E8EB] bg-white"
    >
      <div
        data-mds-element="true"
        className="distributor-stepper mx-auto max-w-7xl px-6 py-6"
      >
        <button
          type="button"
          aria-expanded="true"
          data-mds-element="true"
          className="distributor-stepper-toggle sr-only"
        >
          <div data-mds-element="true" className="distributor-step-count tabular-nums">
            {current.number} of {STEPS.length}
          </div>
        </button>

        <nav aria-label="progress" data-mds-element="true" className="distributor-nav">
          <ol
            data-mds-element="true"
            className="distributor-progress relative flex w-full items-start justify-between"
          >
            {/* 2px #C8CCD2 connector through the circle centres, behind them.
                Inset by half a cell each side so it spans between the outer
                circles rather than past them. Filled circle is 34px, so its
                centre is 17px down. */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute left-[17px] right-[17px] top-[16px] z-0 h-[2px] bg-[#C8CCD2]"
            />
            {STEPS.map((s) => {
              const isCurrent = s.key === step;
              const isDone = s.number < current.number;
              const filled = isCurrent || isDone;
              return (
                <li
                  key={s.key}
                  data-mds-element="true"
                  className="distributor-step relative z-10 flex w-[34px] flex-col items-center pb-[36px]"
                >
                  <div
                    role="button"
                    tabIndex={0}
                    aria-current={isCurrent ? "step" : undefined}
                    data-test-step={isCurrent ? s.key : undefined}
                    aria-label={s.ariaLabel}
                    data-mds-element="true"
                    className="distributor-step-button flex cursor-pointer flex-col items-center"
                    onClick={() => onSelectStep(s.key)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelectStep(s.key);
                      }
                    }}
                  >
                    <div
                      data-mds-element="true"
                      className="distributor-step-inner flex h-[34px] items-center justify-center"
                    >
                      <span
                        data-mds-element="true"
                        className={
                          filled
                            ? "distributor-step-number flex h-[34px] w-[34px] items-center justify-center rounded-full bg-[#1A56DB] text-[15px] font-medium tabular-nums text-white"
                            : "distributor-step-number block h-[10px] w-[10px] rounded-full border-2 border-[#C8CCD2] bg-white"
                        }
                      >
                        {filled ? (isDone ? <StepCheckIcon /> : s.number) : null}
                      </span>
                    </div>
                    <div
                      data-mds-element="true"
                      className="distributor-step-text absolute left-1/2 top-[48px] -translate-x-1/2 whitespace-nowrap"
                    >
                      <div data-mds-element="true">
                        <div data-mds-element="true">
                          <span
                            data-test-textkey={s.textKey}
                            data-non-sensitive="true"
                            className="block text-center text-[15px] text-[#2E3440]"
                          >
                            {s.name}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </nav>
      </div>
    </nav>
  );
}

// White checkmark for a completed step.
function StepCheckIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M20 6 9 17l-5-5"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}


// Dates and Categories have no ported content yet: the view container still
// renders, carrying the right data-test-id, with a heading and nothing else.
// --- dates-view (step 1) ---------------------------------------------------
// Structural port of the dates-view subtree in
// reference/distributor/01-dates.html. That subtree runs:
//
//   div[data-test-id="dates-view"]
//     div.DecorationImageElement-sc-77587fe0-0 > img[sizes="100vw"][alt=""]
//     span.VisuallyHidden > h1[aria-label="Dates"]  ("Dates")
//     div[role="region"] > Stack > Container > Card
//       ├ date + occupancy selection
//       ├ div[data-test-divider="true"][role="none"] > div
//       ├ div > button[data-test-id="voucher-link"]
//       └ button[data-test-id="dates-next-button"][aria-label="Next"]
//
// Reproduced here with plain classes, per SPEC 6.4 (the generated hashes are
// build-versioned and not selectors). The date and occupancy block is
// Marbrook's existing BookingBar, unchanged: the capture's own block is a
// "Select dates" button plus three age-category counters, and swapping
// Marbrook's calendar and guest stepper for those would change behaviour and
// copy, which this port does not do. Only the structure around it is the
// Distributor's.
//
// voucher-link is left out: it is a promotional-code entry point and Marbrook
// has no promo codes, so there is nothing behind it to wire up.
function DatesView({
  checkinIso,
  checkoutIso,
  adults,
  guestChildren,
  onChangeRange,
  onChangeGuests,
  onNext,
}: {
  checkinIso: string;
  checkoutIso: string;
  adults: number;
  guestChildren: number;
  onChangeRange: (checkinIso: string, checkoutIso: string) => void;
  onChangeGuests: (adults: number, children: number) => void;
  onNext: () => void;
}) {
  // The image region takes the largest of three floors, so it can never leave a
  // white gap:
  //   1. 60vh, the original baseline
  //   2. the card's height + HERO_PAD top and bottom — a fixed vh cannot clear a
  //      card whose height varies with the calendar being open
  //   3. the viewport height left below the toolbar and stepper, measured off
  //      the region's own document offset, so the dates step never bottoms out
  //      in white
  const HERO_PAD = 64;
  const cardRef = useRef<HTMLDivElement>(null);
  const heroRef = useRef<HTMLDivElement>(null);
  const [heroPx, setHeroPx] = useState<number | null>(null);
  const [viewportPx, setViewportPx] = useState<number | null>(null);
  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const measure = () => {
      setHeroPx(card.offsetHeight + HERO_PAD * 2);
      const hero = heroRef.current;
      if (hero) {
        // rect.top + scrollY is the region's offset in the document, so the
        // remaining height is stable regardless of scroll position.
        const offsetTop = hero.getBoundingClientRect().top + window.scrollY;
        setViewportPx(Math.max(0, window.innerHeight - offsetTop));
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(card);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  const heroFloors = ["60vh"];
  if (heroPx != null) heroFloors.push(`${heroPx}px`);
  if (viewportPx != null) heroFloors.push(`${viewportPx}px`);
  const heroHeight =
    heroFloors.length > 1 ? `max(${heroFloors.join(", ")})` : "60vh";

  return (
    <>
      {/* First child of dates-view, exactly as in the capture. The captured
          <img> also carries hidden="" — the Distributor paints the picture from
          a CSS background on the wrapper's generated class and keeps the <img>
          only for its srcset. There is no such class here, so the <img> renders
          instead of being hidden; that is the one deliberate divergence. */}
      <div
        data-mds-element="true"
        ref={heroRef}
        className="dates-decoration-image relative w-full"
        style={{ height: heroHeight }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- the capture's
            decoration node is a plain <img>; next/image would wrap it. */}
        <img
          sizes="100vw"
          data-mds-element="true"
          src="/hud_valley_pic.jpg"
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
        />
      </div>

      <span data-mds-element="true" className="sr-only">
        <h1 aria-label="Dates" data-mds-element="true">
          Dates
        </h1>
      </span>

      <div
        role="region"
        data-mds-element="true"
        className="dates-region relative z-10 flex items-center"
        style={{ height: heroHeight, marginTop: `calc(-1 * ${heroHeight})` }}
      >
        <div data-mds-element="true" className="dates-stack w-full">
          <div data-mds-element="true" className="dates-container mx-auto w-full max-w-[560px] px-6">
            <div
              ref={cardRef}
              data-mds-element="true"
              className="dates-card rounded-[8px] bg-white p-[24px] shadow-[0_4px_16px_rgba(0,0,0,.12)]"
            >
              <BookingBar
                checkinIso={checkinIso}
                checkoutIso={checkoutIso}
                adults={adults}
                guestChildren={guestChildren}
                onChangeRange={onChangeRange}
                onChangeGuests={onChangeGuests}
              />

              <button
                aria-disabled="false"
                data-test-id="dates-next-button"
                aria-label="Next"
                type="submit"
                data-mds-element="true"
                className="mt-[20px] h-[46px] w-full rounded-[6px] bg-[#1A56DB] text-[16px] font-medium text-white"
                onClick={onNext}
              >
                <span data-test-textkey="Next" data-non-sensitive="true">
                  Next
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// --- rooms-view (step 2) ---------------------------------------------------
// Structural port of the rooms-view subtree in
// reference/distributor/02-categories.html:
//
//   div[data-test-id="rooms-view"]
//     h1[data-test-id="select-category-heading"] > span[data-test-textkey="SelectCategory"]
//     div[data-test-id="dates-occupancy-header"]           (Card)
//       nights + date range + guests + Edit button
//     Grid > GridItem > div[data-test-id="category-card"]  (one per category)
//
// Two parts of the captured card are deliberately not reproduced, because both
// would mean inventing data Marbrook does not have:
//   - The image carousel (data-test-slide-next / -previous / -image, the
//     camera badge, the index dots). The capture's property ships three photos
//     per category; Marbrook has one image, so a single <img> stands in.
//   - The "More" description expander. Marbrook's descriptions are two lines
//     and render in full, so there is nothing to expand.
function RoomsView({
  checkinIso,
  checkoutIso,
  nights,
  adults,
  guestChildren,
  onEditStay,
  onSelectCategory,
}: {
  checkinIso: string;
  checkoutIso: string;
  nights: number;
  adults: number;
  guestChildren: number;
  onEditStay: () => void;
  onSelectCategory: (id: string) => void;
}) {
  return (
    <div className="mx-auto max-w-7xl px-6 py-10">
      <div data-mds-element="true" className="rooms-view-stack">
        <div data-mds-element="true">
          <h1
            data-test-id="select-category-heading"
            data-mds-element="true"
            className="font-serif text-3xl tracking-tight text-[#23262e]"
          >
            <span data-test-textkey="SelectCategory" data-non-sensitive="true">
              Select category
            </span>
          </h1>
        </div>

        <DatesOccupancyHeader
          checkinIso={checkinIso}
          checkoutIso={checkoutIso}
          nights={nights}
          adults={adults}
          guestChildren={guestChildren}
          onEdit={onEditStay}
        />

        <div data-mds-element="true" className="mt-8">
          <div
            data-mds-element="true"
            className="grid grid-cols-1 gap-6 lg:grid-cols-2"
          >
            {ROOM_CATEGORIES.map((c) => (
              <div key={c.id} data-mds-element="true" className="min-w-0">
                <CategoryCard category={c} onSelect={onSelectCategory} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// SPEC 1.6 reuses this same block as the editable stay summary on steps 2 and
// 3. Only step 2 renders it for now.
function DatesOccupancyHeader({
  checkinIso,
  checkoutIso,
  nights,
  adults,
  guestChildren,
  onEdit,
}: {
  checkinIso: string;
  checkoutIso: string;
  nights: number;
  adults: number;
  guestChildren: number;
  onEdit: () => void;
}) {
  return (
    <div
      data-test-id="dates-occupancy-header"
      data-mds-element="true"
      className="mt-5 rounded-[8px] border border-[#1A56DB] bg-white p-5"
    >
      <div
        data-mds-element="true"
        className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between"
      >
        <div data-mds-element="true">
          <strong data-mds-element="true" className="text-sm text-[#23262e]">
            <div data-mds-element="true">
              <span
                data-test-textkey="NightPluralSelected"
                data-non-sensitive="true"
              >
                Nights selected
              </span>
              &nbsp;{nights}
            </div>
          </strong>
          <div
            data-mds-element="true"
            className="mt-1 flex items-center gap-2 text-sm text-[#23262e]/70"
          >
            <span>
              <span
                data-test-textkey={weekdayTextKey(checkinIso)}
                data-non-sensitive="true"
              >
                {weekdayShort(checkinIso)}
              </span>{" "}
              <span data-localized-entity="true">
                {formatDateNumeric(checkinIso)}
              </span>
            </span>
            <div data-mds-element="true">→</div>
            <span>
              <span
                data-test-textkey={weekdayTextKey(checkoutIso)}
                data-non-sensitive="true"
              >
                {weekdayShort(checkoutIso)}
              </span>{" "}
              <span data-localized-entity="true">
                {formatDateNumeric(checkoutIso)}
              </span>
            </span>
          </div>
        </div>

        <div data-mds-element="true">
          <strong data-mds-element="true" className="text-sm text-[#23262e]">
            <div data-mds-element="true">
              <span
                data-test-textkey="GuestPluralSelected"
                data-non-sensitive="true"
              >
                Guests selected
              </span>
              &nbsp;{adults + guestChildren}
            </div>
          </strong>
          <div
            data-mds-element="true"
            className="mt-1 flex items-center gap-3 text-sm text-[#23262e]/70"
          >
            <div data-mds-element="true">
              <span data-test-textkey="AdultPlural" data-non-sensitive="true">
                Adults
              </span>
              &nbsp;{adults}
            </div>
            {/* The capture's stay had no children, so it evidences no text key
                for a children line. This one is left unkeyed rather than
                guessing at one. */}
            {guestChildren > 0 ? (
              <div data-mds-element="true">Children&nbsp;{guestChildren}</div>
            ) : null}
          </div>
        </div>

        <button
          type="submit"
          data-mds-element="true"
          className="shrink-0 border border-[#1A56DB] px-5 py-2 text-sm text-[#1A56DB]"
          onClick={onEdit}
        >
          <span data-test-textkey="Edit" data-non-sensitive="true">
            Edit
          </span>
        </button>
      </div>
    </div>
  );
}

function CategoryCard({
  category,
  onSelect,
}: {
  category: RoomCategory;
  onSelect: (id: string) => void;
}) {
  return (
    <div
      data-test-id="category-card"
      data-mds-element="true"
      className="flex h-full flex-col rounded-[8px] border border-[#1A56DB] bg-white"
    >
      <div data-mds-element="true" className="flex h-full flex-col">
        <RoomPhoto categoryName={category.name} />

        <div data-mds-element="true" className="flex flex-1 flex-col p-6">
          <h3
            data-test-id="category-card-name"
            data-mds-element="true"
            className="font-serif text-2xl text-[#23262e]"
          >
            <span data-localized-entity="true">{category.name}</span>
          </h3>

          <div data-mds-element="true" className="mt-2">
            {/* The capture carries data-test-id="category-card-max-persons"
                twice: on the <ul> and again on the inner label div. */}
            <ul
              data-test-id="category-card-max-persons"
              data-mds-element="true"
            >
              <li data-mds-element="true" className="flex items-center gap-2">
                <span
                  data-test-icon="profile"
                  aria-hidden="true"
                  data-mds-element="true"
                  className="shrink-0 text-[#23262e]/55"
                >
                  <GuestsIcon />
                </span>
                <div>
                  <div data-mds-element="true">
                    <div
                      data-test-id="category-card-max-persons"
                      data-mds-element="true"
                      className="text-sm text-[#23262e]"
                    >
                      <span data-test-textkey="Sleeps" data-non-sensitive="true">
                        Sleeps
                      </span>
                      &nbsp;{category.sleeps}
                    </div>
                  </div>
                  <div data-mds-element="true" />
                </div>
              </li>
            </ul>
          </div>

          <p className="mt-3 text-sm leading-relaxed text-[#23262e]/75">
            {category.description}
          </p>

          <div
            data-mds-element="true"
            className="mt-6 flex items-end justify-between gap-4 pt-4"
          >
            <div data-mds-element="true">
              <div
                data-test-id="from-price-wrapper"
                data-mds-element="true"
                className="min-w-0"
              >
                <div>
                  <div data-mds-element="true" className="text-xs text-[#23262e]/55">
                    <span data-test-textkey="FromPrice" data-non-sensitive="true">
                      From
                    </span>
                  </div>
                  <strong
                    data-test-id="from-price-value"
                    data-mds-element="true"
                    className="font-serif text-3xl font-normal text-[#23262e]"
                  >
                    <span dir="ltr" data-test-id="localizedCurrency">
                      {formatUsd(category.fromPriceCents)}
                    </span>
                    <span>&nbsp;</span>
                  </strong>
                </div>
              </div>
              <div
                data-mds-element="true"
                className="text-[11px] uppercase tracking-[0.14em] text-[#23262e]/50"
              >
                <span data-test-textkey="PerRoom" data-non-sensitive="true">
                  Per room
                </span>
                {" / "}
                <span data-test-textkey="PerNight" data-non-sensitive="true">
                  Nightly
                </span>
              </div>
              {/* The capture also carries a FeesIncluded span here. Marbrook's
                  destination fee is added on top of nightlyCents rather than
                  included in it, so only the taxes-excluded half is true and
                  only that half is rendered. */}
              <div
                data-test-id="tax-label"
                data-mds-element="true"
                className="mt-1 text-[11px] text-[#23262e]/50"
              >
                (
                <span
                  data-test-id="tax-label"
                  data-test-textkey="ExcludingTaxes"
                  data-non-sensitive="true"
                >
                  Taxes excluded
                </span>
                )
              </div>
            </div>

            <button
              data-test-id="price-footer-button"
              type="button"
              aria-label="Show rates"
              data-mds-element="true"
              className="shrink-0 bg-[#1A56DB] px-6 py-2.5 text-sm font-medium text-white transition hover:bg-[#1545B0]"
              onClick={() => onSelect(category.id)}
            >
              <span data-test-textkey="ShowRates" data-non-sensitive="true">
                Show rates
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Editable Guests / Check-in / Check-out bar. Opens a range calendar for the
// dates and a stepper editor for guests; changes flow up via onChangeRange /
// onChangeGuests and recompute everything downstream.
function BookingBar({
  checkinIso,
  checkoutIso,
  adults,
  guestChildren,
  onChangeRange,
  onChangeGuests,
}: {
  checkinIso: string;
  checkoutIso: string;
  adults: number;
  guestChildren: number;
  onChangeRange: (checkinIso: string, checkoutIso: string) => void;
  onChangeGuests: (adults: number, children: number) => void;
}) {
  const [open, setOpen] = useState<null | "dates" | "guests">(null);
  const toggle = (which: "dates" | "guests") =>
    setOpen((cur) => (cur === which ? null : which));
  const stepper =
    "flex h-[46px] items-center justify-between rounded-[6px] border border-[#D8DBE0] px-3";
  const stepBtn =
    "flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] text-[18px] leading-none text-[#2E3440] disabled:opacity-30";
  return (
    <div>
      {/* Section label, the capture's DatePlural inside the DateRangeWrapper. */}
      <div data-mds-element="true" className="text-[20px] font-semibold text-[#2E3440]">
        <span data-test-textkey="DatePlural" data-non-sensitive="true">
          Dates
        </span>
      </div>

      {/* Date selector: one full-width control opening the existing calendar. */}
      <button
        type="button"
        onClick={() => toggle("dates")}
        className={`mt-[16px] w-full ${stepper} justify-center gap-2 text-[15px] text-[#2E3440]`}
      >
        <span className="shrink-0 text-[#2E3440]" aria-hidden="true">
          <CalendarIcon />
        </span>
        <span data-test-textkey="SelectDatesTitle" data-non-sensitive="true">
          {formatDateLong(checkinIso)} to {formatDateLong(checkoutIso)}
        </span>
      </button>

      <div
        data-test-divider="true"
        role="none"
        data-mds-element="true"
        className="my-[20px]"
      >
        <div data-mds-element="true" className="h-px bg-[#E6E8EB]" />
      </div>

      {/* Adults and children side by side, equal width, 20px gap. Same state
          and the same floors the popover stepper used. */}
      <div className="grid grid-cols-2 gap-[20px]">
        <div
          data-test-id="age-category-occupancy-field"
          data-mds-element="true"
        >
          <div className="text-[15px] text-[#2E3440]">Adults</div>
          <div className={`mt-2 ${stepper}`}>
            <button
              type="button"
              aria-label="Decrement"
              data-test-button-minus="true"
              data-test-id="button-minus-sign"
              className={stepBtn}
              disabled={adults <= 1}
              onClick={() => onChangeGuests(Math.max(1, adults - 1), guestChildren)}
            >
              −
            </button>
            <span className="text-[15px] tabular-nums text-[#2E3440]">{adults}</span>
            <button
              type="button"
              aria-label="Increment"
              data-test-button-plus="true"
              data-test-id="button-plus-sign"
              className={stepBtn}
              onClick={() => onChangeGuests(adults + 1, guestChildren)}
            >
              +
            </button>
          </div>
        </div>
        <div
          data-test-id="age-category-occupancy-field"
          data-mds-element="true"
        >
          <div className="text-[15px] text-[#2E3440]">Children</div>
          <div className={`mt-2 ${stepper}`}>
            <button
              type="button"
              aria-label="Decrement"
              data-test-button-minus="true"
              data-test-id="button-minus-sign"
              className={stepBtn}
              disabled={guestChildren <= 0}
              onClick={() => onChangeGuests(adults, Math.max(0, guestChildren - 1))}
            >
              −
            </button>
            <span className="text-[15px] tabular-nums text-[#2E3440]">
              {guestChildren}
            </span>
            <button
              type="button"
              aria-label="Increment"
              data-test-button-plus="true"
              data-test-id="button-plus-sign"
              className={stepBtn}
              onClick={() => onChangeGuests(adults, guestChildren + 1)}
            >
              +
            </button>
          </div>
        </div>
      </div>

      {open === "dates" ? (
        <DateRangeCalendar
          checkinIso={checkinIso}
          checkoutIso={checkoutIso}
          onSelect={(ci, co) => {
            onChangeRange(ci, co);
            setOpen(null);
          }}
          onClose={() => setOpen(null)}
        />
      ) : null}

      {open === "guests" ? (
        <GuestsEditor
          adults={adults}
          guestChildren={guestChildren}
          onChange={onChangeGuests}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </div>
  );
}


// Lightweight custom range calendar (no date library). Pick check-in then
// check-out; the selected range highlights. Any dates allowed, no past-date or
// availability checking. Hotel chrome: square corners, thin blue, white, sans.
function DateRangeCalendar({
  checkinIso,
  checkoutIso,
  onSelect,
  onClose,
}: {
  checkinIso: string;
  checkoutIso: string;
  onSelect: (checkinIso: string, checkoutIso: string) => void;
  onClose: () => void;
}) {
  const [start, setStart] = useState<string | null>(checkinIso);
  const [end, setEnd] = useState<string | null>(checkoutIso);
  const [view, setView] = useState(() => {
    const d = parseIso(checkinIso);
    return { year: d.getFullYear(), month: d.getMonth() };
  });

  const monthLabel = new Date(view.year, view.month, 1).toLocaleDateString(
    "en-US",
    { month: "long", year: "numeric" },
  );
  const firstWeekday = new Date(view.year, view.month, 1).getDay();
  const daysInMonth = new Date(view.year, view.month + 1, 0).getDate();
  const cells: (string | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push(toIso(new Date(view.year, view.month, day)));
  }

  function shiftMonth(delta: number) {
    setView((v) => {
      const d = new Date(v.year, v.month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  }

  function onPick(iso: string) {
    // No start yet, or a full range already chosen: begin a new range.
    if (!start || (start && end)) {
      setStart(iso);
      setEnd(null);
      return;
    }
    // Second pick before the start: restart from the earlier date.
    if (iso <= start) {
      setStart(iso);
      setEnd(null);
      return;
    }
    setEnd(iso);
    onSelect(start, iso);
  }

  const rangeLo = start;
  const rangeHi = end ?? start;

  return (
    <div className="mt-2 w-full max-w-sm rounded-none border border-[#1A56DB] bg-white p-4 shadow-md">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => shiftMonth(-1)}
          aria-label="Previous month"
          className="px-2 py-1 text-[#1A56DB] hover:bg-[#1A56DB]/5"
        >
          ‹
        </button>
        <div className="text-sm font-medium text-[#23262e]">{monthLabel}</div>
        <button
          type="button"
          onClick={() => shiftMonth(1)}
          aria-label="Next month"
          className="px-2 py-1 text-[#1A56DB] hover:bg-[#1A56DB]/5"
        >
          ›
        </button>
      </div>
      <div className="mt-3 grid grid-cols-7 gap-1 text-center text-[10px] uppercase tracking-[0.1em] text-[#23262e]/45">
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <div key={i}>{d}</div>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {cells.map((iso, i) => {
          if (!iso) return <div key={`e${i}`} />;
          const inRange = rangeLo && rangeHi && iso >= rangeLo && iso <= rangeHi;
          const isEndpoint = iso === start || iso === end;
          const day = Number(iso.slice(-2));
          return (
            <button
              key={iso}
              type="button"
              onClick={() => onPick(iso)}
              className={`h-9 text-sm transition-colors ${
                isEndpoint
                  ? "bg-[#1A56DB] text-white"
                  : inRange
                    ? "bg-[#1A56DB]/15 text-[#23262e]"
                    : "text-[#23262e] hover:bg-[#1A56DB]/10"
              }`}
            >
              {day}
            </button>
          );
        })}
      </div>
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={onClose}
          className="text-xs font-medium text-[#1A56DB] hover:underline"
        >
          Done
        </button>
      </div>
    </div>
  );
}

// Small guests editor with +/- steppers. Adults floor 1, children floor 0.
function GuestsEditor({
  adults,
  guestChildren,
  onChange,
  onClose,
}: {
  adults: number;
  guestChildren: number;
  onChange: (adults: number, children: number) => void;
  onClose: () => void;
}) {
  return (
    <div className="mt-2 w-full max-w-xs rounded-none border border-[#1A56DB] bg-white p-4 shadow-md">
      <Stepper
        label="Adults"
        value={adults}
        min={1}
        onChange={(v) => onChange(v, guestChildren)}
      />
      <div className="mt-3">
        <Stepper
          label="Children"
          value={guestChildren}
          min={0}
          onChange={(v) => onChange(adults, v)}
        />
      </div>
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={onClose}
          className="text-xs font-medium text-[#1A56DB] hover:underline"
        >
          Done
        </button>
      </div>
    </div>
  );
}

function Stepper({
  label,
  value,
  min,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-[#23262e]">{label}</span>
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label={`Decrease ${label.toLowerCase()}`}
          onClick={() => onChange(Math.max(min, value - 1))}
          disabled={value <= min}
          className="h-8 w-8 border border-[#1A56DB] text-[#1A56DB] transition-colors hover:bg-[#1A56DB]/5 disabled:cursor-not-allowed disabled:opacity-40"
        >
          -
        </button>
        <span className="w-5 text-center text-sm font-medium tabular-nums text-[#23262e]">
          {value}
        </span>
        <button
          type="button"
          aria-label={`Increase ${label.toLowerCase()}`}
          onClick={() => onChange(value + 1)}
          className="h-8 w-8 border border-[#1A56DB] text-[#1A56DB] transition-colors hover:bg-[#1A56DB]/5"
        >
          +
        </button>
      </div>
    </div>
  );
}

const iconProps = {
  width: 16,
  height: 16,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function GuestsIcon() {
  return (
    <svg {...iconProps}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg {...iconProps}>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4" />
      <path d="M8 2v4" />
      <path d="M3 10h18" />
    </svg>
  );
}

// --- rates-view (step 3) ---------------------------------------------------
// Structural port of the rates-view subtree in
// reference/distributor/03-rates.html, whose document order is:
//
//   div[data-test-id="rates-view"]
//     h1[data-test-id="select-rate-heading"]
//     div[data-test-id="dates-occupancy-header"]      (same block as step 2)
//     div[data-test-id="category-detail-card"]
//     div[data-test-id="upsells-container"]
//     div[data-test-id="occupancy-container"]
//     div[data-test-id="rates-container"]
//       h2[data-test-id="rates-heading"]
//       Card > ul > li[data-test-id="rate-item"] × n
//
// upsells-container and occupancy-container are not reproduced: Marbrook sells
// no add-on products, and the room/guest counters would duplicate the editing
// the dates-occupancy-header already offers.
function RatesView({
  category,
  rates,
  selectedRateId,
  previewByRateId,
  checkinIso,
  checkoutIso,
  nights,
  adults,
  guestChildren,
  onEditStay,
  onSelectRate,
}: {
  category: RoomCategory;
  rates: Rate[];
  selectedRateId: string | null;
  previewByRateId: Record<string, TeaserPreview>;
  checkinIso: string;
  checkoutIso: string;
  nights: number;
  adults: number;
  guestChildren: number;
  onEditStay: () => void;
  onSelectRate: (id: string) => void;
}) {
  return (
    <div className="mx-auto max-w-7xl px-6 py-10">
      <div data-mds-element="true">
        <h1
          data-test-id="select-rate-heading"
          data-mds-element="true"
          className="font-serif text-3xl tracking-tight text-[#23262e]"
        >
          <span data-test-textkey="SelectRate" data-non-sensitive="true">
            Select rate
          </span>
        </h1>
      </div>

      <DatesOccupancyHeader
        checkinIso={checkinIso}
        checkoutIso={checkoutIso}
        nights={nights}
        adults={adults}
        guestChildren={guestChildren}
        onEdit={onEditStay}
      />

      <CategoryDetailCard category={category} />

      <div
        data-test-id="rates-container"
        data-mds-element="true"
        className="mt-8"
      >
        <div data-mds-element="true">
          <h2
            data-test-id="rates-heading"
            data-mds-element="true"
            className="font-serif text-lg text-[#23262e]"
          >
            <span data-test-textkey="RatePlural" data-non-sensitive="true">
              Rates
            </span>
          </h2>

          <div data-mds-element="true" className="mt-3">
            {/* One Card wrapping one <ul>; the visual cards are <li> rows, as
                SPEC 3.1 notes — there is no per-card Card wrapper. */}
            <div
              data-mds-element="true"
              className="overflow-hidden rounded-[8px] border border-[#1A56DB] bg-white"
            >
              <ul data-mds-element="true" className="divide-y divide-[#23262e]/12">
                {rates.map((r) => (
                  <RateItem
                    key={r.id}
                    rate={r}
                    selected={selectedRateId === r.id}
                    preview={previewByRateId[r.id] ?? null}
                    checkinIso={checkinIso}
                    nights={nights}
                    onSelect={onSelectRate}
                  />
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// The capture's category-detail-card leads with an image carousel, then an h3
// carrying the category name (note: no data-test-id on that h3, unlike
// category-card-name on step 2), a max-persons line, and the description. The
// carousel is replaced by the single RoomPhoto, as on step 2.
function CategoryDetailCard({ category }: { category: RoomCategory }) {
  return (
    <div
      data-test-id="category-detail-card"
      data-mds-element="true"
      className="mt-6 rounded-[8px] border border-[#1A56DB] bg-white"
    >
      <div
        data-mds-element="true"
        className="flex flex-col sm:flex-row sm:items-stretch"
      >
        <div data-mds-element="true" className="sm:w-[45%]">
          <RoomPhoto categoryName={category.name} />
        </div>

        <div data-mds-element="true" className="flex-1 p-6">
          <h3 data-mds-element="true" className="font-serif text-2xl text-[#23262e]">
            <span data-localized-entity="true">{category.name}</span>
          </h3>

          <div data-mds-element="true" className="mt-3">
            <div data-mds-element="true">
              <div
                data-test-id="category-detail-max-persons"
                data-mds-element="true"
                className="flex items-center gap-2 text-sm text-[#23262e]/70"
              >
                <span
                  data-test-icon="profile"
                  aria-hidden="true"
                  data-mds-element="true"
                  className="shrink-0 text-[#23262e]/55"
                >
                  <GuestsIcon />
                </span>
                <div>
                  <span data-test-textkey="MaxPersons" data-non-sensitive="true">
                    Maximum persons
                  </span>
                  :&nbsp;{category.sleeps}
                </div>
              </div>
            </div>

            <p
              data-test-id="category-detail-description"
              data-mds-element="true"
              className="mt-3 max-w-xl text-sm leading-relaxed text-[#23262e]/75"
            >
              <span>{category.description}</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// Verbatim structural port of the rate card in SPEC 3.2. Marbrook's rate name,
// description and price are unchanged; only the wrapper elements and the
// data-test-* attributes are the Distributor's.
//
// The capture's "More" description expander is left out: r.detail is one line
// and renders in full, so there is nothing to expand.
function RateItem({
  rate,
  selected,
  preview,
  checkinIso,
  nights,
  onSelect,
}: {
  rate: Rate;
  selected: boolean;
  preview: TeaserPreview | null;
  checkinIso: string;
  nights: number;
  onSelect: (id: string) => void;
}) {
  return (
    <li
      data-test-id="rate-item"
      data-mds-element="true"
      className={`flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between ${
        selected ? "bg-[#1A56DB]/5" : "bg-white"
      }`}
    >
      <div className="min-w-0 sm:self-start">
        {/* SPEC 2.2: rate-item-name sits inside a bare, attribute-less div, so
            it is not a direct child of the rate-item. */}
        <div>
          <h3
            data-test-id="rate-item-name"
            data-mds-element="true"
            className="font-serif text-4xl text-[#23262e]"
          >
            <span data-localized-entity="true">{rate.name}</span>
          </h3>
        </div>

        <div>
          <p
            data-test-id="rate-item-description"
            data-mds-element="true"
            className="mt-0.5 text-base text-[#23262e]/60"
          >
            <span>{rate.detail}</span>
          </p>
        </div>
      </div>

      <div
        data-mds-element="true"
        className="flex shrink-0 items-center gap-5 sm:flex-col sm:items-end sm:gap-1"
      >
        <div data-mds-element="true" className="text-right">
          {rate.strikeCents !== undefined ? (
            <div
              data-test-id="rate-item-discount"
              data-mds-element="true"
              className="text-sm text-[#23262e]/45"
            >
              <s>
                &nbsp;
                <span dir="ltr" data-test-id="localizedCurrency">
                  {formatUsd(rate.strikeCents)}
                </span>
                &nbsp;
              </s>
            </div>
          ) : null}

          <div data-test-id="from-price-wrapper" data-mds-element="true">
            <strong
              data-mds-element="true"
              className="font-serif text-3xl font-normal text-[#23262e]"
            >
              <span dir="ltr" data-test-id="localizedCurrency">
                {formatUsd(rate.nightlyCents)}
              </span>
              <span>&nbsp;</span>
            </strong>
            <div
              data-mds-element="true"
              className="text-[11px] uppercase tracking-[0.14em] text-[#23262e]/50"
            >
              <span data-test-textkey="PerNight" data-non-sensitive="true">
                Nightly
              </span>
            </div>
          </div>

          {/* As on the category card, the capture's FeesIncluded half is
              omitted: Marbrook's destination fee is added on top of
              nightlyCents rather than included in it. */}
          <div
            data-test-id="tax-label"
            data-mds-element="true"
            className="mt-1 text-[11px] text-[#23262e]/50"
          >
            (
            <span
              data-test-id="tax-label"
              data-test-textkey="ExcludingTaxes"
              data-non-sensitive="true"
            >
              Taxes excluded
            </span>
            )
          </div>

          {/* Bliss installment teaser. No Distributor equivalent; strings come
              from frontend/public/mews-overlay.js. */}
          <BlissTeaser
            preview={preview}
            nightlyCents={rate.nightlyCents}
            rateName={rate.name}
            checkinIso={checkinIso}
            nights={nights}
          />
        </div>

        <button
          data-test-id="price-footer-button"
          type="button"
          aria-label="Book"
          data-mds-element="true"
          className="rounded-none bg-[#1A56DB] px-6 py-2.5 text-sm font-medium text-white transition hover:bg-[#1545B0]"
          onClick={() => onSelect(rate.id)}
        >
          {/* Capture renders AddRoom as "Book now"; Marbrook's existing CTA
              copy is "Book" and is kept. */}
          <span data-test-textkey="AddRoom" data-non-sensitive="true">
            Book
          </span>
        </button>
      </div>
    </li>
  );
}

// --- Bliss teaser + modal --------------------------------------------------
// Strings copied verbatim from frontend/public/mews-overlay.js, which is the
// source of truth. Line references are to that file.
//
// Not ported, deliberately: the plan-selected states (overlay 1740, 1788-1797,
// 2088-2113) and confirmPlan/clearSelection. Marbrook has no selection model
// for this yet, so the modal's CTA selects a cadence within the modal only.
//
// STYLING: also ported verbatim, from triggerCss (1450-1505), modalCss
// (1516-1578) and baseCss (1443-1448), with the CONFIG.brand tokens at 435-452
// substituted in. The overlay renders into a shadow root, so `:host{all:initial}`
// scopes its very generic class names (.card, .head, .body, .opt, .amt …). Here
// the same scoping is done with a `.bliss-ui` root prefix instead. baseCss sets
// font-family to the SAMPLED HOST font, so the faithful reproduction is to
// inherit Marbrook's page font rather than name one.
const BLISS_CSS = `
.bliss-ui *{box-sizing:border-box;margin:0;padding:0;font-family:inherit}

.bliss-ui .trig{display:block;width:100%;margin:0;padding:0;background:none;border:0;border-radius:0;box-shadow:none;color:#51576A;font-size:12px;line-height:1.45;cursor:pointer;text-align:left;white-space:normal;overflow-wrap:break-word}
.bliss-ui .trig:hover .amt{text-decoration:underline}
.bliss-ui .trig:focus-visible{outline:2px solid #C9AFFA;outline-offset:2px}
.bliss-ui .sep{margin:0 5px;opacity:.55}
.bliss-ui .amt{font-weight:600}
.bliss-ui .sub{display:block;margin-top:2px;font-size:11px;font-weight:400;color:#97ACC8}
.bliss-ui .trig[disabled]{cursor:default}

.bliss-ui .scrim{position:fixed;top:0;right:0;bottom:0;left:0;background:rgba(0,0,0,.44);display:flex;align-items:center;justify-content:center;padding:16px}
.bliss-ui .card{width:560px;max-width:100%;max-height:calc(100vh - 32px);overflow:auto;background:#ffffff;color:#51576A;border:1px solid #D9D9D9;border-radius:4px;box-shadow:0 18px 56px rgba(0,0,0,.32)}
.bliss-ui .card:focus{outline:none}
.bliss-ui .head{display:flex;align-items:flex-start;gap:12px;padding:22px 24px;border-bottom:1px solid #D9D9D9}
.bliss-ui .head h2{font-size:17px;font-weight:600;line-height:1.3}
.bliss-ui .head p{font-size:13px;color:#97ACC8;margin-top:4px;line-height:1.4}
.bliss-ui .x{margin-left:auto;background:none;border:0;cursor:pointer;font-size:20px;line-height:1;color:#97ACC8}
.bliss-ui .body{padding:20px 24px 24px}
.bliss-ui .ctx{font-size:13px;color:#97ACC8;margin-bottom:2px;line-height:1.5}
.bliss-ui .fine{font-size:11px;color:#97ACC8;margin-bottom:12px;line-height:1.4}
.bliss-ui .disc{display:block;width:100%;text-align:left;margin:2px 0 8px;padding:8px 0;background:none;border:0;border-top:1px solid #D9D9D9;color:#51576A;font-size:12px;font-weight:600;cursor:pointer}
.bliss-ui .sched{margin:0 0 12px;border:1px solid #D9D9D9;border-radius:4px}
.bliss-ui .sched .row{display:flex;align-items:center;gap:10px;padding:8px 12px;font-size:12px;border-bottom:1px solid #D9D9D9}
.bliss-ui .sched .row:last-child{border-bottom:0}
.bliss-ui .sched .n{width:18px;color:#97ACC8}
.bliss-ui .sched .d{color:#51576A}
.bliss-ui .sched .v{margin-left:auto;font-weight:600;color:#51576A}
.bliss-ui .opt{display:flex;align-items:center;gap:10px;width:100%;text-align:left;padding:11px 12px;margin-bottom:8px;background:transparent;color:#51576A;border:1px solid #D9D9D9;border-radius:4px;cursor:pointer}
.bliss-ui .opt[aria-pressed="true"]{border-color:#C9AFFA;border-width:2px;padding:10px 11px}
.bliss-ui .opt .lbl{font-size:13px;font-weight:600}
.bliss-ui .opt .sub{font-size:11px;color:#97ACC8;margin-top:2px}
.bliss-ui .opt .amt{margin-left:auto;text-align:right}
.bliss-ui .opt .amt b{font-size:14px;font-weight:600;display:block}
.bliss-ui .opt .amt span{font-size:11px;color:#97ACC8}
.bliss-ui .tag{display:inline-block;font-size:9px;letter-spacing:.4px;text-transform:uppercase;padding:2px 6px;border-radius:4px;background:#F0E9FE;border:1px solid #C9AFFA;color:#51576A;margin-left:6px;vertical-align:middle}
.bliss-ui .cta{width:100%;padding:12px;border:0;border-radius:4px;background:#6A629E;color:#ffffff;font-size:13px;font-weight:600;cursor:pointer;margin-top:4px}
.bliss-ui .cta[disabled]{opacity:.5;cursor:default}
.bliss-ui .note{font-size:11px;color:#97ACC8;margin-top:10px;line-height:1.45}
.bliss-ui .msg{font-size:12px;color:#97ACC8;line-height:1.5}

@media (max-width:420px){
.bliss-ui .scrim{align-items:flex-end;padding:0}
.bliss-ui .card{width:100%;max-width:100%;max-height:88vh;border-radius:4px 4px 0 0}
}
`;

function BlissStyles() {
  return <style>{BLISS_CSS}</style>;
}

function BlissTeaser({
  preview,
  nightlyCents,
  rateName,
  checkinIso,
  nights,
  variant = "rate-card",
  selected = false,
  onConfirm,
  policies,
}: {
  preview: TeaserPreview | null;
  nightlyCents: number;
  rateName: string;
  checkinIso: string;
  nights: number;
  // mews-overlay.js branches on t.kind: "rate-card" triggers vs the "details"
  // block on the checkout step. Same component, the overlay's two states.
  variant?: "rate-card" | "details";
  selected?: boolean;
  onConfirm?: (frequency: PublicPlanFrequency) => void;
  policies?: MerchantPolicies | null;
}) {
  const [modalOpen, setModalOpen] = useState(false);

  if (!preview || !preview.eligible || preview.options.length === 0) return null;

  const spread = spreadOption(preview);
  const fallback = fallbackOption(preview);

  // mews-overlay.js:1642-1643. The numerator is the card's own displayed
  // tax-exclusive nightly price, so this figure deliberately does not
  // reconcile with the modal.
  const line =
    spread != null
      ? "Pay installments over time starting at " +
        perNightInstallmentLabel(nightlyCents, spread.numPayments) +
        "/night"
      : null;

  // mews-overlay.js:1646-1647.
  const fallbackLine =
    fallback != null
      ? "from " +
        formatUsd(fallback.perPaymentCents) +
        (fallback.frequency === "monthly" ? "/mo" : " every 2 weeks")
      : null;

  // mews-overlay.js:1670-1671 — the details block quotes the tax-inclusive
  // total, not the pre-tax nightly price.
  const detailsPerNight =
    spread != null
      ? summaryPerNightCents(preview.amountCents, nights, spread.numPayments)
      : null;
  const detailsLine =
    detailsPerNight != null
      ? "Pay installments over time starting at " +
        formatUsd(detailsPerNight) +
        "/night"
      : null;

  const openModal = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setModalOpen(true);
  };

  const modal = modalOpen ? (
    <BlissModal
      preview={preview}
      rateName={rateName}
      checkinIso={checkinIso}
      nights={nights}
      policies={policies}
      onConfirm={
        onConfirm
          ? (f) => {
              onConfirm(f);
              setModalOpen(false);
            }
          : undefined
      }
      onClose={() => setModalOpen(false)}
    />
  ) : null;

  // mews-overlay.js:1704-1777, the details block.
  if (variant === "details") {
    if (selected) {
      // STATE A (mews-overlay.js:1738-1748).
      return (
        <div className="bliss-ui">
          <BlissStyles />
          <div className="details">
            <span className="amt">You&apos;ve selected installment payments</span>
            <button className="link" type="button" onClick={openModal}>
              See details
            </button>
          </div>
          {modal}
        </div>
      );
    }
    // STATE B (mews-overlay.js:1751-1776). No "Pre-tax" on the supporting
    // line: unlike the rate-card figure this one includes tax.
    if (!detailsLine) return null;
    return (
      <div className="bliss-ui">
        <BlissStyles />
        <button
          className="trig details"
          type="button"
          aria-haspopup="dialog"
          onClick={openModal}
        >
          <span className="amt">{detailsLine}</span>
          <span className="sub">No credit check</span>
        </button>
        {modal}
      </div>
    );
  }

  if (!line && !fallbackLine) return null;

  return (
    <div className="bliss-ui mt-1">
      <BlissStyles />
      {/* The teaser line is itself the trigger. Same button semantics the
          overlay's trigger carries (mews-overlay.js:1756-1760). */}
      <button
        type="button"
        aria-haspopup="dialog"
        className="trig"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setModalOpen(true);
        }}
      >
        {line ? (
          <>
            <span className="amt">{line}</span>
            {/* mews-overlay.js:1815. Only on this branch, as in the overlay,
                because it describes this line's basis. */}
            <span className="sub">Pre-tax · No credit check</span>
          </>
        ) : (
          /* mews-overlay.js:1818-1821: prefix, separator, then the line. No
             supporting line on this branch. */
          <>
            <span>Spread this stay over time</span>
            <span className="sep">·</span>
            <span className="amt">{fallbackLine}</span>
          </>
        )}
      </button>

      {modal}
    </div>
  );
}

// Structural port of the overlay's modal, mews-overlay.js:1954-2138.
function BlissModal({
  preview,
  rateName,
  checkinIso,
  nights,
  policies,
  onConfirm,
  onClose,
}: {
  preview: TeaserPreview;
  rateName: string;
  checkinIso: string;
  nights: number;
  policies?: MerchantPolicies | null;
  // mews-overlay.js:2197 confirmPlan. Optional: the rate-card trigger has no
  // confirm target yet, so its CTA stays inert as before.
  onConfirm?: (frequency: PublicPlanFrequency) => void;
  onClose: () => void;
}) {
  // mews-overlay.js:1920 — seeded on open, not left null.
  const [selected, setSelected] = useState<PublicPlanFrequency | null>(() =>
    defaultSelected(preview),
  );
  // mews-overlay.js:1920 sets no scheduleOpen key, so it starts falsy.
  const [scheduleOpen, setScheduleOpen] = useState(false);

  const chosen = preview.options.find((o) => o.frequency === selected) ?? null;

  // mews-overlay.js:1964-1970.
  const ctxBits: string[] = [];
  if (checkinIso) ctxBits.push(shortDate(checkinIso));
  if (nights > 0) ctxBits.push(nights + (nights === 1 ? " night" : " nights"));
  ctxBits.push(formatUsd(preview.amountCents));

  // mews-overlay.js:1862-1872 — the modal host is appended to the document
  // body, fixed to the full viewport at max z-index, not nested in the card.
  return createPortal(
    <div
      className="bliss-ui"
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        zIndex: 2147483647,
      }}
    >
      <BlissStyles />
      <div className="scrim" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="head">
          <div>
            <h2>Spread this stay over time</h2>
            <p>{rateName}</p>
          </div>
          {/* mews-overlay.js:1959. */}
          <button aria-label="Close" type="button" className="x" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="body">
          <div className="ctx">{ctxBits.join(" · ") || "Waiting for dates"}</div>
          {/* mews-overlay.js:1972-1976. The "details" variant does not apply:
              Marbrook has no details-block trigger kind. */}
          <div className="fine">Pre-tax</div>

          {!preview.eligible ? (
            <div className="msg">
              {REASON_COPY[preview.reason] || REASON_COPY.invalid_input}
            </div>
          ) : (
            <>
              {preview.depositAmountCents > 0 ? (
                <div className="ctx">
                  {formatUsd(preview.depositAmountCents)} today, then the balance
                  on the schedule below.
                </div>
              ) : null}

              {preview.options.map((opt) => {
                const isSel = selected === opt.frequency;
                return (
                  <button
                    key={opt.frequency}
                    type="button"
                    className="opt"
                    aria-pressed={isSel ? "true" : "false"}
                    onClick={() => {
                      // mews-overlay.js:2019-2022: clicking the selected row
                      // toggles it off rather than being a no-op.
                      setSelected(isSel ? null : opt.frequency);
                    }}
                  >
                    <div>
                      <div className="lbl">
                        {opt.frequency === "biweekly" ? "Every 2 weeks" : "Monthly"}
                        {opt.recommended ? (
                          <span className="tag">Recommended</span>
                        ) : null}
                      </div>
                      <div className="sub">
                        {opt.numPayments}
                        {opt.numPayments === 1 ? " payment" : " payments"} through{" "}
                        {shortDate(opt.dueDates[opt.dueDates.length - 1]!)}
                      </div>
                    </div>
                    <div className="amt">
                      <b>{formatUsd(opt.perPaymentCents)}</b>
                      <span>per payment</span>
                    </div>
                  </button>
                );
              })}

              {chosen ? (
                <>
                  <button
                    type="button"
                    className="disc"
                    aria-expanded={scheduleOpen ? "true" : "false"}
                    onClick={() => setScheduleOpen((v) => !v)}
                  >
                    {(scheduleOpen ? "▾" : "▸") + "  Payment schedule"}
                  </button>
                  {scheduleOpen ? (
                    <div className="sched">
                      {chosen.dueDates.map((iso, i) => {
                        const last = i === chosen.dueDates.length - 1;
                        return (
                          <div className="row" key={iso}>
                            <span className="n">{i + 1}</span>
                            <span className="d">{shortDate(iso)}</span>
                            <span className="v">
                              {formatUsd(
                                last ? chosen.finalPaymentCents : chosen.perPaymentCents,
                              )}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </>
              ) : null}

              {chosen ? (
                <>
                  {/* Fine print in place of the removed fee breakdown. The
                      fee stays inside the per-payment figures and the
                      schedule. .note treatment (mews-overlay.js:1560). */}
                  <div className="note">
                    Includes a small additional processing fee.
                  </div>

                  {/* Plan policy, .note (mews-overlay.js:1560). */}
                  <ul className="note">
                    {policies ? (
                      <>
                        <li>{refundCopy(policies)}</li>
                        <li>{dueDateCopy(policies)}</li>
                        <li>{failedPaymentCopy(policies)}</li>
                      </>
                    ) : (
                      <>
                        <li>Full refund anytime before your check-in.</li>
                        <li>Each payment runs automatically on the date shown.</li>
                        <li>
                          If a payment does not go through, we retry it before your
                          check-in.
                        </li>
                      </>
                    )}
                  </ul>
                </>
              ) : null}

              {/* mews-overlay.js:2118-2124. Label follows the selection. */}
              <button
                type="button"
                className="cta"
                disabled={!chosen}
                onClick={() => {
                  if (chosen && onConfirm) onConfirm(chosen.frequency);
                }}
              >
                {chosen ? "Update this plan" : "Continue with this plan"}
              </button>
              {/* mews-overlay.js:2136. */}
              <div className="note">
                No card needed here. You will finish checkout the usual way.
              </div>
            </>
          )}
        </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
// --- summary-view (step 4) -------------------------------------------------
// Structural replica of [data-test-id="summary-view"] in
// reference/distributor/04-summary.html. Structure from the capture, data and
// copy from Marbrook.
//
// Omitted, no Marbrook data (same basis as the rooms/rates ports):
//   - image carousel and its slide controls (one photo, no gallery)
//   - reservation quantity stepper: summary-card-counts-wrapper,
//     reservation-counter-decrement-button, -increment-button (no cart)
//   - add-another-reservation-button (no cart)
//   - products and extras: toggle-expandable-box, product, IncludedInRate
//     (no add-on products, and Marbrook's fee is charged on top rather than
//     included in the rate, so IncludedInRate would be false)
//   - the summary-card-rate-description "More" expander (rate.detail is short)
//
// Kept with no capture counterpart, at the funnel's request: the back link,
// category.specs, the nights count, and the "avg per night" line.
//
// TAX SHAPE: Marbrook's additive total is kept — room subtotal + occupancy tax
// + destination fee. The capture's "Included in rate" shape is deliberately NOT
// adopted, because the destination fee really is charged on top here. The
// capture's six-row itemised breakdown collapses to one tax-rate row: Marbrook
// has exactly one tax. The destination fee sits in the line-item area rather
// than under the Taxes disclosure, because it is a fee, not a tax.
function SummaryView({
  category,
  rate,
  pricing,
  nights,
  checkinIso,
  checkoutIso,
  adults,
  guestChildren,
  onBack,
  onCheckout,
}: {
  category: RoomCategory;
  rate: Rate;
  pricing: Pricing;
  nights: number;
  checkinIso: string;
  checkoutIso: string;
  adults: number;
  guestChildren: number;
  onBack: () => void;
  onCheckout: () => void;
}) {
  return (
    <div className="mx-auto max-w-7xl px-6 py-10">
      {/* No capture counterpart; the funnel needs a way back. */}
      <button
        type="button"
        onClick={onBack}
        className="text-sm text-[#1A56DB] underline-offset-2 hover:underline"
      >
        ← Back to rooms
      </button>

      <h1
        data-test-id="summary-heading"
        data-mds-element="true"
        className="mt-3 font-serif text-3xl tracking-tight text-[#23262e]"
      >
        <span data-test-textkey="Summary" data-non-sensitive="true">
          Your stay
        </span>
      </h1>

      <div
        data-test-id="summary-reservation-card"
        data-mds-element="true"
        className="mt-5 overflow-hidden rounded-[8px] border border-[#1A56DB] bg-white"
      >
        <div className="flex gap-5 p-5">
          {/* 2a. The carousel is omitted; the single RoomPhoto stands in, as on
              rooms-view and rates-view. */}
          <div
            data-test-id="summary-card-image"
            data-mds-element="true"
            className="hidden h-24 w-32 shrink-0 overflow-hidden rounded-none sm:block"
          >
            <RoomPhoto categoryName={category.name} compact />
          </div>

          <div className="min-w-0">
            {/* 2b */}
            <h2
              data-test-id="summary-card-name"
              data-mds-element="true"
              className="font-serif text-xl text-[#23262e]"
            >
              <span data-localized-entity="true">{category.name}</span>
            </h2>
            <div className="mt-0.5 text-sm text-[#23262e]/60">{category.specs}</div>

            {/* 2e. Capture: icon rate_management + span[data-test-textkey="Rate"]
                + ":&nbsp;" + the rate name. Marbrook has no rate_management
                glyph, so the marker span carries no icon. */}
            <div
              data-test-id="summary-card-rate"
              data-mds-element="true"
              className="mt-2 text-sm text-[#23262e]/80"
            >
              <span
                data-test-icon="rate_management"
                aria-hidden="true"
                data-mds-element="true"
              />
              <span data-test-textkey="Rate" data-non-sensitive="true">
                Rate
              </span>
              :&nbsp;
              <span data-localized-entity="true">{rate.name}</span>
              <p
                data-test-id="summary-card-rate-description"
                data-mds-element="true"
                className="text-xs text-[#23262e]/55"
              >
                <span>{rate.detail}</span>
              </p>
            </div>
          </div>
        </div>

        <div className="border-t border-[#23262e]/10 px-5 py-4 text-sm">
          <div className="flex flex-wrap items-center gap-x-8 gap-y-2 text-[#23262e]/80">
            {/* 2c. Capture joins the two days with "&nbsp;‐&nbsp;" (U+2010). */}
            <div
              data-test-id="summary-card-date"
              data-mds-element="true"
              className="flex items-center gap-2"
            >
              <span
                data-test-icon="calendar"
                aria-hidden="true"
                data-mds-element="true"
                className="shrink-0 text-[#23262e]/55"
              >
                <CalendarIcon />
              </span>
              <div data-mds-element="true">
                <span>
                  <span>
                    <span
                      data-test-textkey={weekdayTextKey(checkinIso)}
                      data-non-sensitive="true"
                    >
                      {weekdayShort(checkinIso)}
                    </span>{" "}
                    <span data-localized-entity="true">
                      {formatDateNumeric(checkinIso)}
                    </span>
                  </span>
                  &nbsp;‐&nbsp;
                  <span>
                    <span
                      data-test-textkey={weekdayTextKey(checkoutIso)}
                      data-non-sensitive="true"
                    >
                      {weekdayShort(checkoutIso)}
                    </span>{" "}
                    <span data-localized-entity="true">
                      {formatDateNumeric(checkoutIso)}
                    </span>
                  </span>
                </span>
              </div>
            </div>

            {/* 2d */}
            <div
              data-test-id="summary-card-occupancy"
              data-mds-element="true"
              className="flex items-center gap-2"
            >
              <span
                data-test-icon="profile"
                aria-hidden="true"
                data-mds-element="true"
                className="shrink-0 text-[#23262e]/55"
              >
                <GuestsIcon />
              </span>
              <div data-mds-element="true">{guestsLabel(adults, guestChildren)}</div>
            </div>

            {/* No capture counterpart; kept at the funnel's request. */}
            <StayFact label="Nights" value={String(nights)} />
          </div>
        </div>

        {/* Blocks 4-9. */}
        <div className="border-t border-[#23262e]/10 px-5 py-5 text-sm">
          {/* 4. Line item: the capture's label is two data-localized-entity
              spans glued with " + ", its amount a strong > localizedCurrency,
              and its additional-info the per-unit line. */}
          <div className="flex items-baseline justify-between gap-3">
            <strong data-mds-element="true" className="font-normal text-[#23262e]">
              <span data-localized-entity="true">{category.name}</span>
              {"  + "}
              <span data-localized-entity="true">{rate.name}</span>
            </strong>
            <strong data-mds-element="true" className="font-normal text-[#23262e]">
              <span dir="ltr" data-test-id="localizedCurrency">
                {formatUsd(pricing.roomSubtotalCents)}
              </span>
            </strong>
          </div>
          <div
            data-test-id="additional-info"
            data-mds-element="true"
            className="text-xs text-[#23262e]/55"
          >
            {formatUsd(rate.nightlyCents)} × {nights} nights
          </div>

          {/* Destination fee. A fee, not a tax, so it carries no tax-rate
              marker and sits outside the Taxes disclosure. */}
          <div className="mt-2 flex items-baseline justify-between gap-3 text-[#23262e]/80">
            <span>Destination fee ($30/night)</span>
            <span className="tabular-nums">
              <span dir="ltr" data-test-id="localizedCurrency">
                {formatUsd(pricing.destinationFeeCents)}
              </span>
            </span>
          </div>

          {/* 6. */}
          <div
            data-test-divider="true"
            role="none"
            data-mds-element="true"
            className="my-4"
          >
            <div data-mds-element="true" className="h-px bg-[#23262e]/10" />
          </div>

          {/* 7. Taxes. One row: Marbrook has one tax. The aggregate beside the
              toggle is a bare text node in the capture, not a localizedCurrency. */}
          <div className="flex items-baseline justify-between gap-3">
            <button
              data-test-id="tax-breakdown-toggle-expandable-box"
              type="button"
              data-mds-element="true"
              className="text-[#23262e]/80"
            >
              <span data-test-textkey="TaxPlural" data-non-sensitive="true">
                Taxes
              </span>
            </button>
            <div data-mds-element="true" className="tabular-nums text-[#23262e]/80">
              {formatUsd(pricing.occupancyTaxCents)}
            </div>
          </div>
          <div className="mt-1 flex items-baseline justify-between gap-3">
            <div
              data-test-id="tax-rate"
              data-mds-element="true"
              className="text-xs text-[#23262e]/55"
            >
              Occupancy tax (8.875%)
            </div>
            <div data-mds-element="true" className="text-xs tabular-nums text-[#23262e]/55">
              {formatUsd(pricing.occupancyTaxCents)}
            </div>
          </div>

          {/* 8. */}
          <div
            data-test-divider="true"
            role="none"
            data-mds-element="true"
            className="my-4"
          >
            <div data-mds-element="true" className="h-px bg-[#23262e]/10" />
          </div>

          {/* 9. */}
          <div className="flex items-baseline justify-between gap-3">
            <strong
              data-test-id="total-bar-total"
              data-mds-element="true"
              className="font-serif text-base font-normal text-[#23262e]"
            >
              <span data-test-textkey="Total" data-non-sensitive="true">
                Total
              </span>
            </strong>
            <strong
              data-test-id="total-bar-total-value"
              data-mds-element="true"
              className="font-serif text-xl font-semibold text-[#23262e]"
            >
              <span dir="ltr" data-test-id="localizedCurrency">
                {formatUsd(pricing.totalCents)}
              </span>
            </strong>
          </div>
          <div
            data-test-id="total-bar-tax-included"
            data-mds-element="true"
            className="text-right text-[11px] text-[#23262e]/50"
          >
            <span data-test-textkey="TaxIncluded" data-non-sensitive="true">
              Tax included
            </span>
          </div>
          {/* No capture counterpart; existing approved copy. */}
          <div className="text-right text-[11px] text-[#23262e]/50">
            {formatUsd(pricing.avgPerNightCents)} avg per night
          </div>
        </div>
      </div>

      {/* 10. Capture renders Continue; Marbrook's existing CTA copy is
          Checkout and is kept, as with the rate card's Book. */}
      <div className="mt-5 flex justify-end">
        <button
          aria-disabled="false"
          data-test-id="summary-next-button"
          aria-label="Checkout"
          type="submit"
          data-mds-element="true"
          className="rounded-none bg-[#1A56DB] px-8 py-3 text-sm font-medium text-white transition hover:bg-[#1545B0]"
          onClick={onCheckout}
        >
          <span data-test-textkey="Continue" data-non-sensitive="true">
            Checkout
          </span>
        </button>
      </div>
    </div>
  );
}

function StayFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-[0.14em] text-[#23262e]/45">
        {label}
      </div>
      <div className="font-medium text-[#23262e]">{value}</div>
    </div>
  );
}

function CheckoutStep(props: {
  category: RoomCategory;
  bookingTotalCents: number;
  pricing: Pricing;
  nights: number;
  checkinIso: string;
  checkoutPreview: TeaserPreview | null;
  prefix: string;
  setPrefix: (v: string) => void;
  firstName: string;
  setFirstName: (v: string) => void;
  lastName: string;
  setLastName: (v: string) => void;
  phone: string;
  setPhone: (v: string) => void;
  email: string;
  setEmail: (v: string) => void;
  addressLine1: string;
  setAddressLine1: (v: string) => void;
  addressCity: string;
  setAddressCity: (v: string) => void;
  addressState: string;
  setAddressState: (v: string) => void;
  addressZip: string;
  setAddressZip: (v: string) => void;
  rate: Rate;
  paymentMethod: PaymentMethod;
  setPaymentMethod: (v: PaymentMethod) => void;
  setFrequency: (v: PublicPlanFrequency) => void;
  policies: MerchantPolicies | null;
  cardFields: CardFieldState;
  onBack: () => void;
  onBookNow: () => void;
  submitting: boolean;
  error: string | null;
}) {
  const {
    category,
    bookingTotalCents,
    pricing,
    nights,
    checkinIso,
    checkoutPreview,
    prefix,
    setPrefix,
    firstName,
    setFirstName,
    lastName,
    setLastName,
    phone,
    setPhone,
    email,
    setEmail,
    addressLine1,
    setAddressLine1,
    addressCity,
    setAddressCity,
    addressState,
    setAddressState,
    addressZip,
    setAddressZip,
    rate,
    paymentMethod,
    setPaymentMethod,
    setFrequency,
    policies,
    cardFields,
    onBack,
    onBookNow,
    submitting,
    error,
  } = props;


  // The Bliss plan-policy block is driven by the merchant's saved policy
  // settings (refund policy, payment deadline, failed-payment handling), passed
  // down from the parent. Falls back to static copy until loaded.

  const bookLabel = submitting ? "Booking…" : "Book now";

  // Typography sampling for the Bliss host wrapper, mirroring
  // mews-overlay.js:1713-1723: read family, size and weight off the element the
  // block was inserted next to, rather than hardcoding them. The overlay's own
  // anchor (rate-settlement-rule-description-later) is absent here, so the
  // sample comes from the host's parent — the price-breakdown container
  // (div.border-t.pt-4.text-sm), as directed.
  //
  // Applied to the HOST WRAPPER ONLY. It cannot override anything the tile or
  // expansion renders: every text element inside sets its own ported size,
  // weight and colour, and those win over an inherited value. The sample is
  // also read from the host's own parent, so the values it writes are the ones
  // the subtree already inherited — identical computed output, no override.
  const blissHostRef = useRef<HTMLDivElement>(null);
  const [blissHostFont, setBlissHostFont] = useState<{
    fontFamily?: string;
    fontSize?: string;
    fontWeight?: string;
  }>({});
  useEffect(() => {
    const source = blissHostRef.current?.parentElement;
    if (!source) return;
    const cs = window.getComputedStyle(source);
    setBlissHostFont({
      fontFamily: cs.fontFamily,
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
    });
  }, []);

  return (
    <section>
      <button
        type="button"
        onClick={onBack}
        className="text-sm text-[#1A56DB] underline-offset-2 hover:underline"
      >
        ← Back to your stay
      </button>
      <h1 className="mt-3 font-serif text-3xl tracking-tight text-[#23262e]">
        <span data-test-textkey="ContactAndPaymentDetails" data-non-sensitive="true">
          Contact &amp; payment details
        </span>
      </h1>

      {/* Booker toggle. Visual only: Marbrook has no booking-for-someone-else
          model, so enable-booker changes nothing. */}
      <div
        data-test-id="booker-selection"
        data-mds-element="true"
        className="mt-4 flex flex-wrap items-center gap-3 text-sm"
      >
        <span data-test-textkey="BookerDisabled" data-non-sensitive="true" className="text-[#23262e]">
          I&apos;m booking for myself
        </span>
        <button
          data-test-id="enable-booker"
          type="submit"
          data-mds-element="true"
          className="text-[#1A56DB] underline-offset-2 hover:underline"
        >
          <span data-test-textkey="BookerEnabled" data-non-sensitive="true">
            I&apos;m booking for someone else
          </span>
        </button>
      </div>

      {/* Contact info */}
      <div className="mt-5 rounded-[8px] border border-[#1A56DB] bg-white p-6">
        <h3
          data-test-id="checkout-your-details-heading"
          data-mds-element="true"
          className="font-serif text-lg text-[#23262e]"
        >
          <span data-test-textkey="YourDetails" data-non-sensitive="true">
            Your details
          </span>
        </h3>
        <form
          id="contact-details"
          aria-label="Your details"
          className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-6"
        >
          <HotelField label="Prefix" className="sm:col-span-1">
            <select
              value={prefix}
              onChange={(e) => setPrefix(e.target.value)}
              className={hotelInputClass}
            >
              {["Ms", "Mr", "Mx", "Dr"].map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </HotelField>
          <HotelField
            label="First name"
            className="sm:col-span-2"
            field="firstName"
            name="firstName"
            textKey="FirstName"
          >
            <input
              id="firstName"
              name="firstName"
              data-test-id="checkout-field-firstName"
              data-mds-element="true"
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className={hotelInputClass}
            />
          </HotelField>
          <HotelField
            label="Last name"
            className="sm:col-span-3"
            field="lastName"
            name="lastName"
            textKey="LastName"
          >
            <input
              id="lastName"
              name="lastName"
              data-test-id="checkout-field-lastName"
              data-mds-element="true"
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className={hotelInputClass}
            />
          </HotelField>
          {/* Capture: div[data-test-field="phone"] holds a dial-code combobox
              (phone.countryCode / #prefixSelect) beside the number input
              (phone.number). The dial-code select is visual only — Marbrook has
              no country list, so it renders empty. */}
          <HotelField
            label="Phone"
            className="sm:col-span-3"
            field="phone"
            name="phone"
            textKey="PhoneNumber"
          >
            <div className="flex gap-2">
              <div
                data-test-field="prefixSelect"
                data-mds-element="true"
                className="w-24 shrink-0"
              >
                <div
                  data-test-id="checkout-field-phone"
                  data-mds-element="true"
                >
                  <select
                    id="prefixSelect"
                    data-test-id="phone.countryCode"
                    aria-label="Country code"
                    data-mds-element="true"
                    className={hotelInputClass}
                  />
                </div>
              </div>
              <input
                id="phone"
                name="phone"
                data-test-id="phone.number"
                data-mds-element="true"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className={hotelInputClass}
              />
            </div>
          </HotelField>
          <HotelField
            label="Email"
            className="sm:col-span-3"
            field="email"
            name="email"
            textKey="Email"
          >
            <input
              id="email"
              name="email"
              data-test-id="checkout-field-email"
              data-mds-element="true"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={hotelInputClass}
            />
          </HotelField>
          <HotelField label="Address" className="sm:col-span-6">
            <input
              type="text"
              value={addressLine1}
              onChange={(e) => setAddressLine1(e.target.value)}
              className={hotelInputClass}
            />
          </HotelField>
          <HotelField label="City" className="sm:col-span-3">
            <input
              type="text"
              value={addressCity}
              onChange={(e) => setAddressCity(e.target.value)}
              className={hotelInputClass}
            />
          </HotelField>
          <HotelField label="State" className="sm:col-span-1">
            <input
              type="text"
              value={addressState}
              onChange={(e) => setAddressState(e.target.value)}
              className={hotelInputClass}
            />
          </HotelField>
          <HotelField label="ZIP" className="sm:col-span-2">
            <input
              type="text"
              value={addressZip}
              onChange={(e) => setAddressZip(e.target.value)}
              className={hotelInputClass}
            />
          </HotelField>
          {/* Nationality. Visual only: no country list, renders empty. */}
          <HotelField
            label="Nationality"
            className="sm:col-span-3"
            field="nationalityCode"
            name="nationalityCode"
            textKey="Nationality"
          >
            <div
              data-test-id="checkout-field-nationalityCode"
              data-mds-element="true"
            >
              <select
                id="nationalityCode"
                data-mds-element="true"
                className={hotelInputClass}
              />
            </div>
          </HotelField>
          {/* Special requests. Visual only: not passed to createBooking. */}
          <HotelField
            label="Special requests"
            className="sm:col-span-6"
            field="notes"
            name="notes"
            textKey="BookingNotes"
          >
            <textarea
              id="notes"
              name="notes"
              data-test-id="checkout-field-notes"
              data-test-autosize-text-area="true"
              data-mds-element="true"
              rows={3}
              className={hotelInputClass}
            />
          </HotelField>
        </form>
      </div>

      {/* Payment */}
      <div className="mt-5 rounded-[8px] border border-[#1A56DB] bg-white p-6">
        <h2
          data-test-id="checkout-payment-heading"
          data-mds-element="true"
          className="font-serif text-lg text-[#23262e]"
        >
          <span data-test-textkey="Payment" data-non-sensitive="true">
            Payment
          </span>
        </h2>
        <p className="mt-1 text-sm text-[#23262e]/60">
          Choose how you would like to pay for your stay.
        </p>

        <form id="payment-details" aria-label="Payment" className="mt-4 space-y-3">
          {/* Capture's card-network strip. Its "Secured with / Mews Payments"
              line and lock mark are deliberately not rendered: Marbrook is not
              on the Mews payment rail. Container, background, padding and
              position are unchanged; the logos centre in place of the text. */}
          <div className="flex items-center justify-center gap-4 border border-[#23262e]/12 bg-white px-4 py-3">
            <CardNetworkIcons />
          </div>
          {/* No payment-method chooser: the capture has none, and the card
              fields render unconditionally the way they do on the real Mews
              details page. */}
          <CardFields fields={cardFields} />

          {/* Capture repeats the full summary breakdown inside the payment
              card. One tax row (Marbrook has one tax) and the destination fee
              as the only Products-and-extras row. */}
          <div className="border-t border-[#23262e]/10 pt-4 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <strong data-mds-element="true" className="font-normal text-[#23262e]">
                <span data-localized-entity="true">{category.name}</span>
                {"  + "}
                <span data-localized-entity="true">{rate.name}</span>
              </strong>
              <strong data-mds-element="true" className="font-normal text-[#23262e]">
                <span dir="ltr" data-test-id="localizedCurrency">
                  {formatUsd(pricing.roomSubtotalCents)}
                </span>
              </strong>
            </div>
            <div
              data-test-id="additional-info"
              data-mds-element="true"
              className="text-xs text-[#23262e]/55"
            >
              {formatUsd(rate.nightlyCents)} × {nights} nights
            </div>

            <button
              data-test-id="toggle-expandable-box"
              type="button"
              data-mds-element="true"
              className="mt-3 text-[#23262e]/80"
            >
              <span data-test-textkey="ProductsAndExtras" data-non-sensitive="true">
                Products and extras
              </span>
            </button>
            <div className="mt-1 flex items-baseline justify-between gap-3">
              <div
                data-test-id="product"
                data-mds-element="true"
                className="text-xs text-[#23262e]/55"
              >
                Destination fee ($30/night)
              </div>
              <div className="text-xs tabular-nums text-[#23262e]/55">
                <span dir="ltr" data-test-id="localizedCurrency">
                  {formatUsd(pricing.destinationFeeCents)}
                </span>
              </div>
            </div>

            <div
              data-test-divider="true"
              role="none"
              data-mds-element="true"
              className="my-4"
            >
              <div data-mds-element="true" className="h-px bg-[#23262e]/10" />
            </div>

            <div className="flex items-baseline justify-between gap-3">
              <button
                data-test-id="tax-breakdown-toggle-expandable-box"
                type="button"
                data-mds-element="true"
                className="text-[#23262e]/80"
              >
                <span data-test-textkey="TaxPlural" data-non-sensitive="true">
                  Taxes
                </span>
              </button>
              <div data-mds-element="true" className="tabular-nums text-[#23262e]/80">
                {formatUsd(pricing.occupancyTaxCents)}
              </div>
            </div>
            <div className="mt-1 flex items-baseline justify-between gap-3">
              <div
                data-test-id="tax-rate"
                data-mds-element="true"
                className="text-xs text-[#23262e]/55"
              >
                Occupancy tax (8.875%)
              </div>
              <div className="text-xs tabular-nums text-[#23262e]/55">
                {formatUsd(pricing.occupancyTaxCents)}
              </div>
            </div>

            <div
              data-test-divider="true"
              role="none"
              data-mds-element="true"
              className="my-4"
            >
              <div data-mds-element="true" className="h-px bg-[#23262e]/10" />
            </div>

            <div className="flex items-baseline justify-between gap-3">
              <strong
                data-test-id="total-bar-total"
                data-mds-element="true"
                className="font-serif text-base font-normal text-[#23262e]"
              >
                <span data-test-textkey="Total" data-non-sensitive="true">
                  Total
                </span>
              </strong>
              <strong
                data-test-id="total-bar-total-value"
                data-mds-element="true"
                className="font-serif text-xl font-semibold text-[#23262e]"
              >
                <span dir="ltr" data-test-id="localizedCurrency">
                  {formatUsd(bookingTotalCents)}
                </span>
              </strong>
            </div>
            <div
              data-test-id="total-bar-tax-included"
              data-mds-element="true"
              className="text-right text-[11px] text-[#23262e]/50"
            >
              <span data-test-textkey="TaxIncluded" data-non-sensitive="true">
                Tax included
              </span>
            </div>

            {/* Bliss block, injected here to mirror the overlay's placement:
                mews-overlay.js:2479-2500 climbs from its anchor to that anchor's
                top-level container and inserts immediately after it. The anchor
                on the real page is rate-settlement-rule-description-later; that
                line is deliberately absent here, so per instruction the anchor
                is total-bar-tax-included. Its parent has many children, so the
                climb stops at the anchor itself and the block lands directly
                after it. Host styling mirrors mews-overlay.js:2493-2497. */}
            <div
              ref={blissHostRef}
              data-bliss-details=""
              style={{
                marginTop: 10,
                width: "100%",
                gridColumn: "1 / -1",
                ...blissHostFont,
              }}
            >
              {/* The overlay's details-step trigger (mews-overlay.js:1704-1777):
                  a teaser line that opens the modal, plus a selected state once
                  a plan is confirmed. The plan choices, schedule, disclosure
                  rows and plan policy all live inside that modal. */}
              <BlissTeaser
                variant="details"
                preview={checkoutPreview}
                nightlyCents={rate.nightlyCents}
                rateName={rate.name}
                checkinIso={checkinIso}
                nights={nights}
                selected={paymentMethod === "bliss"}
                policies={policies}
                onConfirm={(f) => {
                  // mews-overlay.js:2197 confirmPlan.
                  setFrequency(f);
                  setPaymentMethod("bliss");
                }}
              />
            </div>
          </div>
        </form>

        {/* Capture: divider, then the two consent checkboxes. Both visual only
            — Marbrook captures no consent — and both links point nowhere. */}
        <div
          data-test-divider="true"
          role="none"
          data-mds-element="true"
          className="my-5"
        >
          <div data-mds-element="true" className="h-px bg-[#23262e]/10" />
        </div>

        <div
          data-test-id="checkout-field-agreeWithConditions"
          data-mds-element="true"
          className="flex items-start gap-2 text-sm text-[#23262e]/80"
        >
          <input
            id="terms-and-conditions-checkbox"
            type="checkbox"
            className="mt-1 shrink-0"
          />
          <div id="terms-and-conditions-checkbox-label">
            <span data-test-textkey="AgreeTo" data-non-sensitive="true">
              I agree to the
            </span>{" "}
            <span
              data-test-textkey="PropertyTermsAndConditions"
              data-non-sensitive="true"
              className="underline underline-offset-2"
            >
              Property Terms and Conditions
            </span>
          </div>
        </div>

        <div
          data-test-id="marketing-emails-checkbox"
          data-mds-element="true"
          className="mt-3 flex items-start gap-2 text-sm text-[#23262e]/80"
        >
          <input
            id="marketing-emails-checkbox"
            type="checkbox"
            className="mt-1 shrink-0"
          />
          <div id="marketing-emails-checkbox-label">
            <span
              data-test-textkey="SendMarketingEmailsTemplateEnterpriseAndChain"
              data-non-sensitive="true"
            >
              I&apos;d like to occasionally receive marketing emails from{" "}
              {DEMO_HOTEL.businessName}.
            </span>{" "}
            <span data-test-textkey="PropertyPrivacyPolicySentence" data-non-sensitive="true">
              Please see our
            </span>{" "}
            <span
              data-test-textkey="PropertyPrivacyPolicy"
              data-non-sensitive="true"
              className="underline underline-offset-2"
            >
              Property Privacy Policy
            </span>
          </div>
        </div>
      </div>

      {error ? (
        <p className="mt-4 rounded-none bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {/* Capture renders Confirm; Marbrook's existing CTA copy is kept. */}
      <button
        data-test-id="checkout-next-button"
        aria-label={bookLabel}
        aria-disabled={submitting ? "true" : "false"}
        data-mds-element="true"
        type="button"
        onClick={onBookNow}
        disabled={submitting}
        className={`mt-5 w-full rounded-none px-6 py-3.5 text-center text-sm font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-60 ${
          paymentMethod === "bliss"
            ? "bg-[#C9AFFA] hover:bg-[#BBA0F4]"
            : "bg-[#1A56DB] hover:bg-[#1545B0]"
        }`}
      >
        <span data-test-textkey="Confirm" data-non-sensitive="true">
          {bookLabel}
        </span>
      </button>

      {/* Policies (below the payment CTA so it's consistent across methods). */}
      <div className="mt-5 rounded-[8px] border border-[#1A56DB] bg-white p-6">
        <h2 className="font-serif text-lg text-[#23262e]">Policies</h2>
        <div className="mt-4 space-y-3 text-sm text-[#23262e]/75">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <PolicyLine label="Check-in" value="Check-in after 4:00 PM" />
            <PolicyLine label="Check-out" value="Check-out before 11:00 AM" />
          </div>
          <PolicyLine label="Room" value={category.name} />
          <p>Credit card required to guarantee your reservation.</p>
          <PolicyLine label="Cancellation" value={rate.cancellationPolicy} />
        </div>
      </div>
    </section>
  );
}

const hotelInputClass =
  "w-full rounded-none border border-[#23262e]/20 bg-white px-3 py-2.5 text-sm text-[#23262e] focus:border-[#1A56DB] focus:outline-none";

// `field`, `name` and `textKey` are the capture's markers
// (05-details.html: div[data-test-field] > label#<name>-label > span[data-test-textkey]).
// All three are optional: the Marbrook-only fields the capture has no
// counterpart for (Prefix, Address, City, State, ZIP) render without them.
function HotelField({
  label,
  className,
  field,
  name,
  textKey,
  children,
}: {
  label: string;
  className?: string;
  field?: string;
  name?: string;
  textKey?: string;
  children: React.ReactNode;
}) {
  const inner = (
    <label
      id={name ? `${name}-label` : undefined}
      htmlFor={name}
      className={`block ${field ? "" : (className ?? "")}`}
    >
      <span className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-[#23262e]/55">
        {textKey ? (
          <span data-test-textkey={textKey} data-non-sensitive="true">
            {label}
          </span>
        ) : (
          label
        )}
      </span>
      {children}
    </label>
  );
  if (!field) return inner;
  return (
    <div
      className={className}
      data-test-field={field}
      data-mds-element="true"
    >
      {inner}
    </div>
  );
}

// Stacked label/value line for the Policies block. Stacked rather than inline
// so the copy needs no colon connector.
function PolicyLine({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-[0.14em] text-[#23262e]/45">
        {label}
      </div>
      <div className="text-[#23262e]">{value}</div>
    </div>
  );
}

// Reusable card entry fields (demo only, no validation or submission). Rendered
// under whichever payment option is selected. The "hotel" tone gives it the thin
// blue outline on white; the "bliss" tone keeps the neutral panel that sits
// inside the lavender installments section.
function CardFields({
  fields,
  tone = "hotel",
}: {
  fields: CardFieldState;
  tone?: "hotel" | "bliss";
}) {
  const {
    cardNumber,
    setCardNumber,
    cardExp,
    setCardExp,
    cardCvv,
    setCardCvv,
    cardName,
    setCardName,
  } = fields;
  const shell =
    tone === "hotel"
      ? "border border-[#1A56DB] bg-white"
      : "border border-[#23262e]/12 bg-white";
  return (
    <div className={`space-y-3 rounded-none ${shell} p-4`}>
      {/* Capture: div[data-test-field="number"] > label#number-label +
          div[data-test-id="field-pci-proxy-card-number"][id="pci-proxy-card-number"],
          whose only child is the cross-origin Datatrans iframe. The host
          structure is reproduced; the iframe is absent and Marbrook's plain
          demo input sits in its place. Same for CVV below. */}
      <div data-test-field="number" data-mds-element="true">
      <label id="number-label" htmlFor="number" className="block">
        <span className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-[#23262e]/55">
          <span data-test-textkey="PaymentCardNumber" data-non-sensitive="true">
            Card number
          </span>
        </span>
        <div
          data-test-id="field-pci-proxy-card-number"
          id="pci-proxy-card-number"
          className="relative"
        >
          <span
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#23262e]/40"
            aria-hidden="true"
          >
            <CardGlyph />
          </span>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            placeholder="1234 1234 1234 1234"
            value={cardNumber}
            onChange={(e) => setCardNumber(formatCardNumber(e.target.value))}
            className={`${hotelInputClass} pl-9`}
          />
        </div>
      </label>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div data-test-field="expiration" data-mds-element="true">
        <label id="expiration-label" htmlFor="expiration" className="block">
          <span className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-[#23262e]/55">
            <span data-test-textkey="PaymentCardExpiration" data-non-sensitive="true">
              Expiration date
            </span>
          </span>
          <input
            id="expiration"
            name="expiration"
            data-test-id="checkout-field-expiration"
            data-mds-element="true"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            placeholder="MM/YY"
            value={cardExp}
            onChange={(e) => setCardExp(formatCardExp(e.target.value))}
            className={hotelInputClass}
          />
        </label>
        </div>
        <div data-test-field="cvv" data-mds-element="true">
        <label id="cvv-label" htmlFor="cvv" className="block">
          <span className="mb-1 flex items-center gap-1 text-[11px] uppercase tracking-[0.14em] text-[#23262e]/55">
            <span data-test-textkey="PaymentCardCVV" data-non-sensitive="true">
              CVV
            </span>
            <span
              className="text-[#23262e]/40"
              title="3 digit security code on the back of your card"
              aria-label="3 digit security code on the back of your card"
            >
              <InfoGlyph />
            </span>
          </span>
          <div data-test-id="field-pci-proxy-cvv" id="pci-proxy-cvv">
            <input
              id="cvv"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              placeholder="123"
              value={cardCvv}
              onChange={(e) => setCardCvv(formatCvv(e.target.value))}
              className={hotelInputClass}
            />
          </div>
        </label>
        </div>
      </div>
      <div data-test-field="holderName" data-mds-element="true">
      <label id="holderName-label" htmlFor="holderName" className="block">
        <span className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-[#23262e]/55">
          <span data-test-textkey="NameOnCard" data-non-sensitive="true">
            Name on card
          </span>
        </span>
        <input
          id="holderName"
          name="holderName"
          data-test-id="checkout-field-holderName"
          data-mds-element="true"
          type="text"
          autoComplete="off"
          placeholder="Full name"
          value={cardName}
          onChange={(e) => setCardName(e.target.value)}
          className={hotelInputClass}
        />
      </label>
      </div>
    </div>
  );
}

function BookedPanel({
  booked,
  category,
  rate,
  stayLabel,
}: {
  booked: BookedState;
  category: RoomCategory;
  rate: Rate;
  stayLabel: string;
}) {
  return (
    <section>
      <div className="rounded-[8px] border border-[#1A56DB] bg-white p-6">
        <h1 className="font-serif text-3xl tracking-tight text-[#23262e]">
          You are booked
        </h1>
        <p className="mt-1 text-sm text-[#23262e]/70">
          {category.name} · {rate.name}
        </p>
        <div className="mt-4">
          <PolicyLine label="Stay" value={stayLabel} />
        </div>
        <p className="mt-5 text-sm text-[#23262e]/75">
          A confirmation is on its way to your email.
        </p>
        {booked.method === "bliss" ? (
          <p className="mt-2 text-sm text-[#23262e]/75">
            Track and manage your payments{" "}
            <Link
              href={`/plan/${booked.plan.bookingToken}`}
              className="text-[#6A629E] underline underline-offset-2 hover:text-[#564E89]"
            >
              here
            </Link>
            .
          </p>
        ) : null}
      </div>
    </section>
  );
}

function CardNetworkIcons() {
  return (
    <div className="flex shrink-0 items-center gap-3">
      <Image
        src="/card-logos/visa.png"
        alt="Visa"
        width={600}
        height={500}
        className="h-[22px] w-auto"
      />
      <Image
        src="/card-logos/mastercard.png"
        alt="Mastercard"
        width={800}
        height={800}
        className="h-[22px] w-auto"
      />
      <Image
        src="/card-logos/amex.png"
        alt="American Express"
        width={2000}
        height={1125}
        className="h-[22px] w-auto"
      />
    </div>
  );
}

// Generic card glyph shown inside the Card number field.
function CardGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M2 10h20" />
    </svg>
  );
}

// Info glyph (CVV help) with a native tooltip via the parent's title attribute.
function InfoGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </svg>
  );
}

function PricePanel({
  category,
  rate,
  pricing,
  nights,
  checkinIso,
  checkoutIso,
  adults,
  guestChildren,
}: {
  category: RoomCategory;
  rate: Rate | null;
  pricing: Pricing | null;
  nights: number;
  checkinIso: string;
  checkoutIso: string;
  adults: number;
  guestChildren: number;
}) {
  return (
    <div className="rounded-[8px] border border-[#1A56DB] bg-white p-5">
      <div className="text-[11px] uppercase tracking-[0.18em] text-[#23262e]/50">
        Your stay
      </div>
      <div className="mt-2 font-serif text-lg leading-snug text-[#23262e]">
        {formatDateShort(checkinIso)} to {formatDateShort(checkoutIso)}
      </div>
      <div className="text-sm text-[#23262e]/60">
        {nights} nights · {guestsLabel(adults, guestChildren)}
      </div>

      <div className="mt-4 border-t border-[#23262e]/10 pt-4">
        {rate && pricing ? (
          <>
            <div className="text-sm font-medium text-[#23262e]">{category.name}</div>
            <div className="text-xs text-[#23262e]/55">{rate.name}</div>
            <div className="mt-3">
              <PriceLines rate={rate} pricing={pricing} nights={nights} />
            </div>
          </>
        ) : (
          <p className="text-sm text-[#23262e]/55">
            Choose a rate to see your price details.
          </p>
        )}
      </div>
    </div>
  );
}

function PriceLines({
  rate,
  pricing,
  nights,
}: {
  rate: Rate;
  pricing: Pricing;
  nights: number;
}) {
  return (
    <div className="text-sm">
      <div className="space-y-2 text-[#23262e]/80">
        <Line
          label={`${formatUsd(rate.nightlyCents)} × ${nights} nights`}
          value={formatUsd(pricing.roomSubtotalCents)}
        />
        <Line
          label="Occupancy tax (8.875%)"
          value={formatUsd(pricing.occupancyTaxCents)}
        />
        <Line
          label="Destination fee ($30/night)"
          value={formatUsd(pricing.destinationFeeCents)}
        />
      </div>
      <div className="mt-3 flex items-baseline justify-between border-t border-[#23262e]/10 pt-3">
        <span className="font-serif text-base text-[#23262e]">Total</span>
        <span className="font-serif text-xl font-semibold text-[#23262e]">
          {formatUsd(pricing.totalCents)}
        </span>
      </div>
      <div className="mt-1 text-right text-[11px] text-[#23262e]/50">
        {formatUsd(pricing.avgPerNightCents)} avg per night
      </div>
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

function RoomPhoto({
  categoryName,
  compact = false,
}: {
  categoryName: string;
  compact?: boolean;
}) {
  // Gradient base shows as a tasteful placeholder. If a real photo exists at
  // frontend/public/marbrook-room.jpg it loads as a cover image on top of the
  // gradient; if the file is absent the layer is transparent and the gradient
  // remains. Drop a photo at that path to upgrade the hero with no code change.
  return (
    <div
      className={`relative w-full overflow-hidden bg-gradient-to-br from-[#d9d2c4] via-[#cdd6d8] to-[#b8bcc9] ${
        compact ? "h-full" : "h-72 sm:h-96"
      }`}
      aria-hidden="true"
    >
      <div className="absolute inset-0 opacity-40 [background-image:radial-gradient(circle_at_25%_30%,rgba(255,255,255,0.6),transparent_45%),radial-gradient(circle_at_80%_70%,rgba(35,38,46,0.18),transparent_50%)]" />
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: "url(/marbrook-room.jpg)" }}
      />
      {!compact ? (
        <span className="absolute bottom-3 right-4 rounded-none bg-black/25 px-2 py-0.5 text-[11px] uppercase tracking-[0.2em] text-white/90">
          {categoryName}
        </span>
      ) : null}
    </div>
  );
}
