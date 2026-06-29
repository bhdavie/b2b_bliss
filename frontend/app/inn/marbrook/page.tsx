"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  createBooking,
  devLogin,
  updateMerchant,
  DEFAULT_PLAN_RULES,
} from "@/lib/api";
import { previewEligibility, formatScheduleDate } from "@/lib/eligibility";
import { calcInstallmentPlan } from "@/lib/blissFee";
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
import { BlissWordmark } from "@/components/BlissWordmark";

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
function perNightInstallmentLabel(nightlyCents: number, count: number): string {
  return `$${Math.round(nightlyCents / count / 100)}`;
}

type Rate = {
  id: string;
  name: string;
  detail: string;
  nightlyCents: number;
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

const ROOM = {
  name: "King with Terrace",
  specs: "1 King bed · Sleeps 2 · 260 sq ft",
  description:
    "A corner room with a private terrace overlooking the courtyard gardens. Soaking tub, walk-in rain shower, and a writing nook framed by tall windows.",
};

const RATES: Rate[] = [
  {
    id: "advance",
    name: "Advance purchase rate",
    detail: "Pay in full to lock in the lowest rate. Non-refundable.",
    nightlyCents: 38500,
    // Temporary alignment with the Bliss installment policy so the page never
    // shows two contradicting cancellation statements. Per-hotel policies come
    // later.
    cancellationPolicy: "Full refund anytime before your check-in.",
  },
  {
    id: "flexible",
    name: "Best flexible rate",
    detail: "Free cancellation up to 48 hours before arrival.",
    nightlyCents: 42900,
    cancellationPolicy: "Full refund anytime before your check-in.",
  },
];

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

type Step = "room" | "stay" | "checkout";
type PaymentMethod = "card" | "bliss";

type PlanOptionPreview = {
  numPayments: number;
  dueDates: string[];
  recommended: boolean;
  feeCents: number;
  totalWithFeeCents: number;
  perPaymentCents: number;
  finalPaymentCents: number;
};
type PlanPreview = {
  biweekly: PlanOptionPreview | null;
  monthly: PlanOptionPreview | null;
};
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
  const [step, setStep] = useState<Step>("room");
  const [rateId, setRateId] = useState<string | null>(null);
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

  const rate = useMemo(
    () => RATES.find((r) => r.id === rateId) ?? null,
    [rateId],
  );

  // Number of biweekly installments for the room/rate-card teaser. Uses the
  // existing eligibility helper (mirror of PlanEligibilityService) so the
  // cadence matches what the /pay handoff will quote. Date-driven for a
  // no-deposit plan, so it's the same N for every rate.
  const biweeklyInstallments = useMemo<number | null>(() => {
    const preview = previewEligibility(
      new Date(),
      parseIso(checkinIso),
      RATES[0]!.nightlyCents * nights,
      DEFAULT_PLAN_RULES,
    );
    if (!preview.eligible) return null;
    const biweekly = preview.options.find((o) => o.frequency === "biweekly");
    return biweekly ? biweekly.numPayments : null;
  }, [checkinIso, nights]);

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

  // Client-side plan preview for the inline installments selector. Cadence and
  // due dates come from the eligibility mirror; per-payment amounts come from
  // the shared calcInstallmentPlan, so the numbers match /pay and the backend
  // exactly. No backend write happens here; the plan is created on Book now.
  const planPreview = useMemo<PlanPreview | null>(() => {
    if (!pricing) return null;
    const preview = previewEligibility(
      new Date(),
      parseIso(checkinIso),
      pricing.totalCents,
      DEFAULT_PLAN_RULES,
    );
    if (!preview.eligible) return null;
    const forFrequency = (f: PublicPlanFrequency): PlanOptionPreview | null => {
      const opt = preview.options.find((o) => o.frequency === f);
      if (!opt) return null;
      const calc = calcInstallmentPlan({
        baseCents: pricing.totalCents,
        numPayments: opt.numPayments,
      });
      return {
        numPayments: opt.numPayments,
        dueDates: opt.dueDates,
        recommended: opt.recommended,
        ...calc,
      };
    };
    return { biweekly: forFrequency("biweekly"), monthly: forFrequency("monthly") };
  }, [pricing, checkinIso]);

  function selectRate(id: string) {
    setRateId(id);
    setStep("stay");
    window.scrollTo({ top: 0 });
  }

  function goToCheckout() {
    setStep("checkout");
    window.scrollTo({ top: 0 });
  }

  function onAddRoom() {
    alert("This demo is set up for a single room. Continue to checkout to book your stay.");
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
      serviceName: `${ROOM.name} · ${rate.name}`,
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
        paymentMethodId: "pm_card_visa",
        frequency,
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

  return (
    <div className="min-h-screen bg-white text-[#23262e] font-sans">
      <SiteHeader />

      {/* Shared across all three steps so the hero image, overlay card, and
          stay bar stay identically positioned from Choose your room through
          Checkout. */}
      <HeroBanner />
      <BookingBar
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
      />

      <main className="mx-auto max-w-7xl px-6 py-8">
        <StepBar step={step} />

        <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-[1fr_320px]">
          <div className="min-w-0">
            {step === "room" ? (
              <RoomStep
                onSelectRate={selectRate}
                selectedRateId={rateId}
                installmentCount={biweeklyInstallments}
              />
            ) : null}

            {step === "stay" && rate && pricing ? (
              <StayStep
                rate={rate}
                pricing={pricing}
                nights={nights}
                checkinIso={checkinIso}
                checkoutIso={checkoutIso}
                adults={adults}
                guestChildren={children}
                onBack={() => setStep("room")}
                onAddRoom={onAddRoom}
                onCheckout={goToCheckout}
              />
            ) : null}

            {step === "checkout" && rate && pricing ? (
              booked ? (
                <BookedPanel
                  booked={booked}
                  rate={rate}
                  stayLabel={stayRangeLabel(checkinIso, checkoutIso)}
                />
              ) : (
                <CheckoutStep
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
                  frequency={frequency}
                  setFrequency={setFrequency}
                  planPreview={planPreview}
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
                  onBack={() => setStep("stay")}
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
      </main>

      <footer className="mx-auto max-w-7xl px-6 pb-12 pt-4 text-xs text-[#23262e]/45">
        Marbrook House · 118 Greenwich Avenue, Hudson, NY · A boutique riverside hotel
      </footer>
    </div>
  );
}

function SiteHeader() {
  return (
    <header className="border-b border-[#23262e]/10 bg-white">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-3">
          <div className="flex items-center text-[#23262e]" aria-hidden="true">
            <span
              className="text-5xl leading-none"
              style={{ fontFamily: "var(--font-caveat), cursive", fontWeight: 700 }}
            >
              MH
            </span>
          </div>
          <div>
            <div className="font-serif text-2xl leading-tight tracking-tight text-[#23262e]">
              Marbrook House
            </div>
            <div className="text-xs uppercase tracking-[0.22em] text-[#23262e]/55">
              Hudson Valley, New York
            </div>
          </div>
        </div>
        <nav className="hidden gap-7 text-sm uppercase tracking-[0.18em] text-[#23262e]/60 sm:flex">
          <span>Rooms</span>
          <span>Dining</span>
          <span>The grounds</span>
          <span className="text-[#23262e]">Reserve</span>
        </nav>
      </div>
    </header>
  );
}

function HeroBanner() {
  return (
    <section className="relative w-full">
      <div
        className="h-[370px] w-full bg-cover bg-bottom"
        style={{ backgroundImage: "url(/hud_valley_pic.jpg)" }}
        role="img"
        aria-label="Marbrook House and the Hudson Valley"
      />
      <div className="pointer-events-none absolute inset-x-0 bottom-0">
        <div className="mx-auto max-w-7xl px-6 pb-8">
          <div className="pointer-events-auto max-w-sm rounded-none border border-white/50 bg-white/85 p-6 shadow-xl backdrop-blur-md">
            <h1 className="font-serif text-3xl tracking-tight text-[#23262e]">
              Marbrook House
            </h1>
            <div className="mt-3 space-y-2 text-sm text-[#23262e]/80">
              <ContactLine icon={<PinIcon />}>
                118 Greenwich Avenue, Hudson, NY 12534
              </ContactLine>
              <ContactLine icon={<PhoneIcon />}>(518) 555-0190</ContactLine>
              <ContactLine icon={<GlobeIcon />}>marbrookhouse.com</ContactLine>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function ContactLine({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="shrink-0 text-[#23262e]/55" aria-hidden="true">
        {icon}
      </span>
      <span>{children}</span>
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
  return (
    <div className="mx-auto mt-5 max-w-7xl px-6">
      <div className="grid grid-cols-1 divide-y divide-[#23262e]/12 overflow-hidden rounded-none border border-[#1A56DB] bg-white shadow-sm sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <BookingCell
          icon={<GuestsIcon />}
          label="Guests"
          value={guestsLabel(adults, guestChildren)}
          active={open === "guests"}
          onClick={() => toggle("guests")}
        />
        <BookingCell
          icon={<CalendarIcon />}
          label="Check-in"
          value={formatDateLong(checkinIso)}
          active={open === "dates"}
          onClick={() => toggle("dates")}
        />
        <BookingCell
          icon={<CalendarIcon />}
          label="Check-out"
          value={formatDateLong(checkoutIso)}
          active={open === "dates"}
          onClick={() => toggle("dates")}
        />
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

function BookingCell({
  icon,
  label,
  value,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={active}
      className={`flex w-full items-center gap-3 px-5 py-4 text-left transition-colors ${
        active ? "bg-[#1A56DB]/5" : "hover:bg-[#1A56DB]/5"
      }`}
    >
      <span className="shrink-0 text-[#1A56DB]" aria-hidden="true">
        {icon}
      </span>
      <div>
        <div className="text-[11px] uppercase tracking-[0.16em] text-[#1A56DB]">
          {label}
        </div>
        <div className="text-sm font-medium text-[#23262e]">{value}</div>
      </div>
    </button>
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

function PinIcon() {
  return (
    <svg {...iconProps}>
      <path d="M21 10c0 7-9 12-9 12s-9-5-9-12a9 9 0 0 1 18 0Z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg {...iconProps}>
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92Z" />
    </svg>
  );
}

function GlobeIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10Z" />
    </svg>
  );
}

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

function StepBar({ step }: { step: Step }) {
  const steps: { key: Step; label: string }[] = [
    { key: "room", label: "Choose your room" },
    { key: "stay", label: "Your stay" },
    { key: "checkout", label: "Checkout" },
  ];
  const activeIndex = steps.findIndex((s) => s.key === step);
  return (
    <ol className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs uppercase tracking-[0.16em]">
      {steps.map((s, i) => {
        const state =
          i < activeIndex ? "done" : i === activeIndex ? "active" : "todo";
        return (
          <li key={s.key} className="flex items-center gap-3">
            <span
              className={
                state === "active"
                  ? "text-[#1A56DB]"
                  : state === "done"
                    ? "text-[#23262e]/70"
                    : "text-[#23262e]/35"
              }
            >
              <span className="mr-2 font-medium tabular-nums">{i + 1}</span>
              {s.label}
            </span>
            {i < steps.length - 1 ? (
              <span className="text-[#23262e]/25">/</span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function RoomStep({
  onSelectRate,
  selectedRateId,
  installmentCount,
}: {
  onSelectRate: (id: string) => void;
  selectedRateId: string | null;
  installmentCount: number | null;
}) {
  return (
    <section>
      <h1 className="font-serif text-3xl tracking-tight text-[#23262e]">
        {ROOM.name}
      </h1>
      <p className="mt-1 text-sm text-[#23262e]/65">{ROOM.specs}</p>

      <div className="mt-5 overflow-hidden rounded-none border border-[#1A56DB] bg-white">
        <RoomPhoto />
        <div className="p-6">
          <p className="max-w-xl text-sm leading-relaxed text-[#23262e]/75">
            {ROOM.description}
          </p>

          <h2 className="mt-7 font-serif text-lg text-[#23262e]">
            Choose a rate
          </h2>
          <div className="mt-3 space-y-3">
            {RATES.map((r) => (
              <div
                key={r.id}
                className={`flex flex-col gap-4 rounded-none border-2 p-5 sm:flex-row sm:items-center sm:justify-between ${
                  selectedRateId === r.id
                    ? "border-[#1A56DB] bg-[#1A56DB]/5"
                    : "border-[#1A56DB] bg-white"
                }`}
              >
                <div className="min-w-0 sm:self-start">
                  <div className="font-serif text-4xl text-[#23262e]">{r.name}</div>
                  <p className="mt-0.5 text-base text-[#23262e]/60">{r.detail}</p>
                </div>
                <div className="flex shrink-0 items-center gap-5 sm:flex-col sm:items-end sm:gap-1">
                  <div className="text-right">
                    <div className="font-serif text-3xl text-[#23262e]">
                      {formatUsd(r.nightlyCents)}
                    </div>
                    <div className="text-[11px] uppercase tracking-[0.14em] text-[#23262e]/50">
                      per night
                    </div>
                    {installmentCount ? (
                      <div className="mt-1">
                        <div className="text-[11px] font-bold text-[#6A629E]">
                          or pay {perNightInstallmentLabel(r.nightlyCents, installmentCount)}/night over{" "}
                          {installmentCount} installments
                        </div>
                        <div className="text-[10px] text-[#23262e]/45">
                          no credit check · excluding taxes
                        </div>
                      </div>
                    ) : (
                      <div className="mt-0.5 text-[11px] text-[#23262e]/60">
                        or pay over time with Bliss
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => onSelectRate(r.id)}
                    className="rounded-none bg-[#1A56DB] px-6 py-2.5 text-sm font-medium text-white transition hover:bg-[#1545B0]"
                  >
                    Book
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function StayStep({
  rate,
  pricing,
  nights,
  checkinIso,
  checkoutIso,
  adults,
  guestChildren,
  onBack,
  onAddRoom,
  onCheckout,
}: {
  rate: Rate;
  pricing: Pricing;
  nights: number;
  checkinIso: string;
  checkoutIso: string;
  adults: number;
  guestChildren: number;
  onBack: () => void;
  onAddRoom: () => void;
  onCheckout: () => void;
}) {
  return (
    <section>
      <button
        type="button"
        onClick={onBack}
        className="text-sm text-[#1A56DB] underline-offset-2 hover:underline"
      >
        ← Back to rooms
      </button>
      <h1 className="mt-3 font-serif text-3xl tracking-tight text-[#23262e]">
        Your stay
      </h1>

      <div className="mt-5 overflow-hidden rounded-none border border-[#1A56DB] bg-white">
        <div className="flex gap-5 p-5">
          <div className="hidden h-24 w-32 shrink-0 overflow-hidden rounded-none sm:block">
            <RoomPhoto compact />
          </div>
          <div className="min-w-0">
            <div className="font-serif text-xl text-[#23262e]">{ROOM.name}</div>
            <div className="mt-0.5 text-sm text-[#23262e]/60">{ROOM.specs}</div>
            <div className="mt-2 text-sm text-[#23262e]/80">{rate.name}</div>
            <p className="text-xs text-[#23262e]/55">{rate.detail}</p>
          </div>
        </div>

        <div className="border-t border-[#23262e]/10 px-5 py-4 text-sm">
          <div className="flex flex-wrap items-center gap-x-8 gap-y-2 text-[#23262e]/80">
            <StayFact label="Check-in" value={formatDateLong(checkinIso)} />
            <StayFact label="Check-out" value={formatDateLong(checkoutIso)} />
            <StayFact label="Guests" value={guestsLabel(adults, guestChildren)} />
            <StayFact label="Nights" value={String(nights)} />
          </div>
        </div>

        <div className="border-t border-[#23262e]/10 px-5 py-5">
          <PriceLines rate={rate} pricing={pricing} nights={nights} />
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="button"
          onClick={onAddRoom}
          className="rounded-none border border-[#1A56DB] bg-white px-5 py-3 text-sm font-medium text-[#1A56DB] transition hover:bg-[#1A56DB]/5"
        >
          Add a room
        </button>
        <button
          type="button"
          onClick={onCheckout}
          className="rounded-none bg-[#1A56DB] px-8 py-3 text-sm font-medium text-white transition hover:bg-[#1545B0]"
        >
          Checkout
        </button>
      </div>
    </section>
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
  frequency: PublicPlanFrequency;
  setFrequency: (v: PublicPlanFrequency) => void;
  planPreview: PlanPreview | null;
  cardFields: CardFieldState;
  onBack: () => void;
  onBookNow: () => void;
  submitting: boolean;
  error: string | null;
}) {
  const {
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
    frequency,
    setFrequency,
    planPreview,
    cardFields,
    onBack,
    onBookNow,
    submitting,
    error,
  } = props;

  const selectedOption =
    frequency === "monthly" ? planPreview?.monthly : planPreview?.biweekly;
  const biweeklyTeaser = planPreview?.biweekly ?? null;

  // The Bliss plan-policy block is driven by the merchant's saved policy
  // settings (refund policy, payment deadline, failed-payment handling), read
  // from the public merchants endpoint. Falls back to static copy until loaded.
  const [policies, setPolicies] = useState<MerchantPolicies | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchPublicMerchant(DEMO_HOTEL.slug)
      .then((m) => {
        if (!cancelled && m) setPolicies(m.policies);
      })
      .catch(() => {
        // leave policies null -> static fallback copy renders
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const bookLabel = submitting ? "Booking…" : "Book now";

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
        Checkout
      </h1>

      {/* Contact info */}
      <div className="mt-5 rounded-none border border-[#1A56DB] bg-white p-6">
        <h2 className="font-serif text-lg text-[#23262e]">Contact info</h2>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-6">
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
          <HotelField label="First name" className="sm:col-span-2">
            <input
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className={hotelInputClass}
            />
          </HotelField>
          <HotelField label="Last name" className="sm:col-span-3">
            <input
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className={hotelInputClass}
            />
          </HotelField>
          <HotelField label="Phone" className="sm:col-span-3">
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className={hotelInputClass}
            />
          </HotelField>
          <HotelField label="Email" className="sm:col-span-3">
            <input
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
        </div>
      </div>

      {/* Payment */}
      <div className="mt-5 rounded-none border border-[#1A56DB] bg-white p-6">
        <h2 className="font-serif text-lg text-[#23262e]">Payment</h2>
        <p className="mt-1 text-sm text-[#23262e]/60">
          Choose how you would like to pay for your stay.
        </p>

        <div className="mt-4 space-y-3">
          {/* Credit / debit card */}
          <PaymentOption
            selected={paymentMethod === "card"}
            onSelect={() => setPaymentMethod("card")}
            accent="neutral"
          >
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="font-medium text-[#23262e]">
                  Credit or debit card
                </div>
                <div className="text-sm text-[#23262e]/55">
                  Pay your full balance.
                </div>
              </div>
              <CardNetworkIcons />
            </div>
          </PaymentOption>

          {/* Card option expands inline with the card fields. Pays in full. */}
          {paymentMethod === "card" ? <CardFields fields={cardFields} /> : null}

          {/* Pay in installments over time — the only place Bliss brand appears. */}
          <PaymentOption
            selected={paymentMethod === "bliss"}
            onSelect={() => setPaymentMethod("bliss")}
            accent="bliss"
          >
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="font-medium text-[#51576A]">
                  Pay installments over time
                </div>
                <div className="text-sm text-[#51576A]/70">
                  Split your stay into smaller payments on your debit or credit
                  card. No interest, no credit check.
                </div>
              </div>
              <div className="shrink-0 text-right">
                <BlissWordmark className="text-base text-[#6A629E]" />
                {biweeklyTeaser ? (
                  <>
                    <div className="mt-1 text-sm font-medium text-[#51576A]">
                      {biweeklyTeaser.numPayments} installments of{" "}
                      {formatUsd(biweeklyTeaser.perPaymentCents)}
                    </div>
                    <div className="text-[10px] text-[#23262e]/45">
                      no credit check
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          </PaymentOption>

          {/* Installments expansion: plan choices, schedule, plan policy, and
              the card the installments run on. All computed client-side; no
              backend write until Book now. */}
          {paymentMethod === "bliss" && planPreview ? (
            <div className="space-y-5 rounded-none border border-brand-lavender bg-white p-4 font-sans">
              <div>
                <div className="text-[11px] font-medium uppercase tracking-[0.6px] text-brand-navy/60">
                  Choose your plan
                </div>
                <div className="mt-2.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  <PlanChoice
                    label="Every 2 weeks"
                    option={planPreview.biweekly}
                    selected={frequency === "biweekly"}
                    onSelect={() => setFrequency("biweekly")}
                  />
                  <PlanChoice
                    label="Monthly"
                    option={planPreview.monthly}
                    selected={frequency === "monthly"}
                    onSelect={() => setFrequency("monthly")}
                  />
                </div>
              </div>

              {selectedOption ? (
                <PlanSchedule option={selectedOption} />
              ) : null}

              <div>
                <div className="text-[11px] font-medium uppercase tracking-[0.6px] text-brand-navy/60">
                  Plan policy
                </div>
                <ul className="mt-2 space-y-1.5 text-sm text-brand-navy/85">
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
              </div>

              <div>
                <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.6px] text-brand-navy/60">
                  Card for your installments
                </div>
                <CardFields fields={cardFields} tone="bliss" />
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {error ? (
        <p className="mt-4 rounded-none bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <button
        type="button"
        onClick={onBookNow}
        disabled={submitting}
        className={`mt-5 w-full rounded-none px-6 py-3.5 text-center text-sm font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-60 ${
          paymentMethod === "bliss"
            ? "bg-[#C9AFFA] hover:bg-[#BBA0F4]"
            : "bg-[#1A56DB] hover:bg-[#1545B0]"
        }`}
      >
        {bookLabel}
      </button>

      {/* Policies (below the payment CTA so it's consistent across methods). */}
      <div className="mt-5 rounded-none border border-[#1A56DB] bg-white p-6">
        <h2 className="font-serif text-lg text-[#23262e]">Policies</h2>
        <div className="mt-4 space-y-3 text-sm text-[#23262e]/75">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <PolicyLine label="Check-in" value="Check-in after 4:00 PM" />
            <PolicyLine label="Check-out" value="Check-out before 11:00 AM" />
          </div>
          <PolicyLine label="Room" value={ROOM.name} />
          <p>Credit card required to guarantee your reservation.</p>
          <PolicyLine label="Cancellation" value={rate.cancellationPolicy} />
        </div>
      </div>
    </section>
  );
}

const hotelInputClass =
  "w-full rounded-none border border-[#23262e]/20 bg-white px-3 py-2.5 text-sm text-[#23262e] focus:border-[#1A56DB] focus:outline-none";

function HotelField({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`block ${className ?? ""}`}>
      <span className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-[#23262e]/55">
        {label}
      </span>
      {children}
    </label>
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
      <label className="block">
        <span className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-[#23262e]/55">
          Card number
        </span>
        <div className="relative">
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
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-[#23262e]/55">
            Expiration date
          </span>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            placeholder="MM/YY"
            value={cardExp}
            onChange={(e) => setCardExp(formatCardExp(e.target.value))}
            className={hotelInputClass}
          />
        </label>
        <label className="block">
          <span className="mb-1 flex items-center gap-1 text-[11px] uppercase tracking-[0.14em] text-[#23262e]/55">
            CVV
            <span
              className="text-[#23262e]/40"
              title="3 digit security code on the back of your card"
              aria-label="3 digit security code on the back of your card"
            >
              <InfoGlyph />
            </span>
          </span>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            placeholder="123"
            value={cardCvv}
            onChange={(e) => setCardCvv(formatCvv(e.target.value))}
            className={hotelInputClass}
          />
        </label>
      </div>
      <label className="block">
        <span className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-[#23262e]/55">
          Name on card
        </span>
        <input
          type="text"
          autoComplete="off"
          placeholder="Full name"
          value={cardName}
          onChange={(e) => setCardName(e.target.value)}
          className={hotelInputClass}
        />
      </label>
    </div>
  );
}

// One plan-frequency choice (Every 2 weeks / Monthly) in the inline selector.
// Mirrors the /pay PlanCard: brand-purple border + lavender fill when selected,
// neutral otherwise. All text is the sans body font.
function PlanChoice({
  label,
  option,
  selected,
  onSelect,
}: {
  label: string;
  option: PlanOptionPreview | null;
  selected: boolean;
  onSelect: () => void;
}) {
  if (!option) return null;
  const lastDate = option.dueDates[option.dueDates.length - 1];
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`relative rounded-none p-3 text-left transition-colors ${
        selected
          ? "border-2 border-[#C9AFFA] bg-brand-lavender/20"
          : "border-[0.5px] border-brand-neutral bg-white hover:border-brand-dusty"
      }`}
    >
      {option.recommended ? (
        <span className="absolute -top-[9px] left-[12px] rounded-none bg-brand-lavender px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.3px] text-white">
          Recommended
        </span>
      ) : null}
      <div className="flex items-baseline justify-between gap-2">
        <span
          className={`text-sm font-medium ${selected ? "text-brand-purple" : "text-brand-navy"}`}
        >
          {label}
        </span>
        <span
          className={`text-base font-semibold tabular-nums ${selected ? "text-brand-purple" : "text-brand-navy"}`}
        >
          {formatUsd(option.perPaymentCents)}
        </span>
      </div>
      <div className="mt-0.5 text-[11px] text-brand-navy/60">
        {option.numPayments} payments
        {lastDate ? ` through ${formatScheduleDate(lastDate)}` : ""}
      </div>
    </button>
  );
}

// Dated schedule for the selected plan. Collapsed to the first payment by
// default; an expander reveals the full lavender-chip schedule. The final row
// absorbs the rounding remainder so the rows sum to the fee-inclusive total.
// Sans body font throughout.
function PlanSchedule({ option }: { option: PlanOptionPreview }) {
  const [expanded, setExpanded] = useState(false);
  const rows = option.dueDates.map((d, i) => ({
    date: d,
    amountCents:
      i === option.dueDates.length - 1
        ? option.finalPaymentCents
        : option.perPaymentCents,
  }));
  const visible = expanded ? rows : rows.slice(0, 1);
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-[0.6px] text-brand-navy/60">
        Your schedule
      </div>
      <div className="mt-2 space-y-1.5">
        {visible.map((r) => (
          <div
            key={r.date}
            className="flex items-center justify-between rounded-none bg-brand-lavender/20 px-3 py-2 text-sm"
          >
            <span className="text-brand-navy/80">{formatScheduleDate(r.date)}</span>
            <span className="font-medium tabular-nums text-brand-navy">
              {formatUsd(r.amountCents)}
            </span>
          </div>
        ))}
      </div>
      {rows.length > 1 ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="mt-2 text-xs font-medium text-brand-purple hover:underline"
        >
          {expanded ? "Hide schedule" : `See all ${rows.length} payments`}
        </button>
      ) : null}
    </div>
  );
}

// Inline confirmation shown after Book now. No /pay navigation. Shared by both
// payment paths; the installment path adds a single portal link below.
function BookedPanel({
  booked,
  rate,
  stayLabel,
}: {
  booked: BookedState;
  rate: Rate;
  stayLabel: string;
}) {
  return (
    <section>
      <div className="rounded-none border border-[#1A56DB] bg-white p-6">
        <h1 className="font-serif text-3xl tracking-tight text-[#23262e]">
          You are booked
        </h1>
        <p className="mt-1 text-sm text-[#23262e]/70">
          {ROOM.name} · {rate.name}
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

function PaymentOption({
  selected,
  onSelect,
  accent,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  accent: "neutral" | "bliss";
  children: React.ReactNode;
}) {
  const ring = selected
    ? accent === "bliss"
      ? "border border-[#C9AFFA] ring-1 ring-[#C9AFFA] bg-[#C9AFFA]/8"
      : "border border-[#1A56DB] ring-1 ring-[#1A56DB]/30 bg-[#1A56DB]/5"
    : accent === "bliss"
      ? "border border-[#C9AFFA] bg-white hover:border-[#97ACC8]"
      : "border border-[#1A56DB] bg-white hover:border-[#1545B0]";
  const dot = selected
    ? accent === "bliss"
      ? "border-[#97ACC8] bg-[#C9AFFA]"
      : "border-[#1A56DB] bg-[#1A56DB]"
    : "border-[#23262e]/30 bg-white";
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full items-start gap-3 rounded-none p-4 text-left transition ${ring}`}
    >
      <span
        className={`mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${dot}`}
        aria-hidden="true"
      >
        {selected ? <span className="h-1.5 w-1.5 rounded-full bg-white" /> : null}
      </span>
      <span className="min-w-0 flex-1">{children}</span>
    </button>
  );
}

// Card-network logos shown top-right of the card option. Bare transparent PNGs
// (no pill/box background), constrained to a uniform height so the differing
// aspect ratios scale by width without stretching.
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
  rate,
  pricing,
  nights,
  checkinIso,
  checkoutIso,
  adults,
  guestChildren,
}: {
  rate: Rate | null;
  pricing: Pricing | null;
  nights: number;
  checkinIso: string;
  checkoutIso: string;
  adults: number;
  guestChildren: number;
}) {
  return (
    <div className="rounded-none border border-[#1A56DB] bg-white p-5">
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
            <div className="text-sm font-medium text-[#23262e]">{ROOM.name}</div>
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

function RoomPhoto({ compact = false }: { compact?: boolean }) {
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
          King with terrace
        </span>
      ) : null}
    </div>
  );
}
