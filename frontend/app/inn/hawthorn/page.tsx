"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchPublicMerchant } from "@/lib/publicApi";

type Room = {
  id: string;
  name: string;
  description: string;
  nightlyCents: number;
};

const ROOMS: Room[] = [
  { id: "garden", name: "Garden Room", description: "queen, no view", nightlyCents: 29500 },
  { id: "harbor", name: "Harbor View Room", description: "queen, ocean view", nightlyCents: 42500 },
  { id: "lighthouse", name: "Lighthouse Suite", description: "king, oversized, balcony", nightlyCents: 65000 },
  { id: "captain", name: "The Captain's Quarters", description: "2-bedroom suite, top floor", nightlyCents: 89500 },
];

const DEFAULT_ROOM_ID = "lighthouse";

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseIso(iso: string): [number, number, number] {
  const parts = iso.split("-").map(Number);
  return [parts[0] ?? 1970, parts[1] ?? 1, parts[2] ?? 1];
}

function addDays(iso: string, days: number): string {
  const [y, m, d] = parseIso(iso);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return toIsoDate(dt);
}

function addMonths(iso: string, months: number): string {
  const [y, m, d] = parseIso(iso);
  const dt = new Date(y, m - 1 + months, d);
  return toIsoDate(dt);
}

function nightsBetween(checkin: string, checkout: string): number {
  const [yi, mi, di] = parseIso(checkin);
  const [yo, mo, doo] = parseIso(checkout);
  const a = new Date(yi, mi - 1, di).getTime();
  const b = new Date(yo, mo - 1, doo).getTime();
  return Math.round((b - a) / (1000 * 60 * 60 * 24));
}

function formatUsd(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export default function HawthornInnPage() {
  const router = useRouter();
  const today = useMemo(() => toIsoDate(new Date()), []);
  const defaultCheckin = useMemo(() => addMonths(today, 3), [today]);
  const defaultCheckout = useMemo(() => addDays(defaultCheckin, 3), [defaultCheckin]);

  const [roomId, setRoomId] = useState(DEFAULT_ROOM_ID);
  const [checkin, setCheckin] = useState(defaultCheckin);
  const [checkout, setCheckout] = useState(defaultCheckout);
  const [name, setName] = useState("John Doe");
  const [email, setEmail] = useState("john@example.com");
  const [phone, setPhone] = useState("");
  const [discountBasisPoints, setDiscountBasisPoints] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchPublicMerchant("hawthorn-camden")
      .then((m) => {
        if (cancelled || m == null) return;
        setDiscountBasisPoints(m.policies.discountBasisPoints);
      })
      .catch(() => {
        // Leave default 0; the inn page is a demo asset and a backend hiccup
        // shouldn't break the rest of the checkout mockup.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const room = ROOMS.find((r) => r.id === roomId) ?? ROOMS[0]!;
  const nights = nightsBetween(checkin, checkout);
  const totalCents = nights > 0 ? nights * room.nightlyCents : 0;
  const canBook = nights > 0 && name.trim().length > 0 && email.trim().length > 0;

  function onCheckinChange(value: string) {
    setCheckin(value);
    if (nightsBetween(value, checkout) <= 0) {
      setCheckout(addDays(value, 1));
    }
  }

  function onBookWithBliss() {
    if (!canBook) return;
    const description = `${room.name}, ${nights} ${nights === 1 ? "night" : "nights"}`;
    const params = new URLSearchParams({
      total: String(totalCents),
      checkin,
      checkout,
      name,
      email,
      description,
    });
    if (phone.trim().length > 0) params.set("phone", phone.trim());
    params.set("return_url", `${window.location.origin}/inn/hawthorn`);
    router.push(`/checkout/hawthorn-camden?${params.toString()}`);
  }

  function onBookNow() {
    alert(
      "Card checkout is a placeholder for this demo. Use the Bliss link to test the real flow.",
    );
  }

  return (
    <div className="min-h-screen bg-[#f7f1e6] text-[#1e2a3a] font-sans">
      <header className="border-b border-[#1e2a3a]/15 bg-gradient-to-b from-[#e9efe8] to-[#f7f1e6]">
        <div className="mx-auto max-w-3xl px-6 py-10 text-center">
          <div className="mx-auto mb-4 h-12 w-12 text-[#2a4131]" aria-hidden="true">
            <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M8 40 L24 14 L40 40 Z" />
              <path d="M14 40 L14 30 L34 30 L34 40" />
              <circle cx="24" cy="22" r="1.5" fill="currentColor" />
            </svg>
          </div>
          <h1 className="font-serif text-4xl tracking-tight text-[#2a4131]">
            The Hawthorn at Camden
          </h1>
          <p className="mt-2 text-sm uppercase tracking-[0.25em] text-[#1e2a3a]/60">
            Coastal Maine · Est. 1894
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-10 space-y-6">
        <Card title="Your stay">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Room">
              <select
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                className="w-full rounded border border-[#1e2a3a]/20 bg-white px-3 py-2 focus:border-[#2a4131] focus:outline-none"
              >
                {ROOMS.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} ({r.description}): {formatUsd(r.nightlyCents)}/night
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Nightly rate">
              <ReadOnly value={`${formatUsd(room.nightlyCents)}/night`} />
            </Field>
            <Field label="Check-in">
              <input
                type="date"
                value={checkin}
                min={today}
                onChange={(e) => onCheckinChange(e.target.value)}
                className="w-full rounded border border-[#1e2a3a]/20 bg-white px-3 py-2 focus:border-[#2a4131] focus:outline-none"
              />
            </Field>
            <Field label="Check-out">
              <input
                type="date"
                value={checkout}
                min={addDays(checkin, 1)}
                onChange={(e) => setCheckout(e.target.value)}
                className="w-full rounded border border-[#1e2a3a]/20 bg-white px-3 py-2 focus:border-[#2a4131] focus:outline-none"
              />
            </Field>
            <Field label="Nights">
              <ReadOnly value={nights > 0 ? String(nights) : "—"} />
            </Field>
            <Field label="Total">
              <ReadOnly value={nights > 0 ? formatUsd(totalCents) : "—"} emphasis />
            </Field>
          </div>
        </Card>

        <Card title="Guest details">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Full name">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded border border-[#1e2a3a]/20 bg-white px-3 py-2 focus:border-[#2a4131] focus:outline-none"
              />
            </Field>
            <Field label="Email">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded border border-[#1e2a3a]/20 bg-white px-3 py-2 focus:border-[#2a4131] focus:outline-none"
              />
            </Field>
            <Field label="Phone (optional)">
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+1 555 555 5555"
                className="w-full rounded border border-[#1e2a3a]/20 bg-white px-3 py-2 focus:border-[#2a4131] focus:outline-none"
              />
            </Field>
          </div>
        </Card>

        <Card title="Cancellation policy">
          <p className="text-sm leading-relaxed text-[#1e2a3a]/75">
            10% deposit due at booking. Balance due at check-in. Full deposit refund if you
            cancel 30 or more days before check-in. After that, the deposit is non-refundable.
          </p>
        </Card>

        <Card title="Payment">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field label="Cardholder name">
                <input
                  type="text"
                  defaultValue={name}
                  className="w-full rounded border border-[#1e2a3a]/20 bg-white px-3 py-2 focus:border-[#2a4131] focus:outline-none"
                />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="Card number">
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="1234 1234 1234 1234"
                  className="w-full rounded border border-[#1e2a3a]/20 bg-white px-3 py-2 focus:border-[#2a4131] focus:outline-none"
                />
              </Field>
            </div>
            <Field label="Expiry (MM/YY)">
              <input
                type="text"
                inputMode="numeric"
                placeholder="MM/YY"
                className="w-full rounded border border-[#1e2a3a]/20 bg-white px-3 py-2 focus:border-[#2a4131] focus:outline-none"
              />
            </Field>
            <Field label="CVC">
              <input
                type="text"
                inputMode="numeric"
                placeholder="123"
                className="w-full rounded border border-[#1e2a3a]/20 bg-white px-3 py-2 focus:border-[#2a4131] focus:outline-none"
              />
            </Field>
            <Field label="ZIP code">
              <input
                type="text"
                inputMode="numeric"
                placeholder="12345"
                className="w-full rounded border border-[#1e2a3a]/20 bg-white px-3 py-2 focus:border-[#2a4131] focus:outline-none"
              />
            </Field>
          </div>

          <button
            type="button"
            onClick={onBookNow}
            disabled={!canBook}
            className="mt-6 w-full rounded bg-[#2a4131] px-4 py-4 text-center font-medium text-[#f7f1e6] shadow-sm transition hover:bg-[#1f3024] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Book now
          </button>

          <div className="mt-3 text-center">
            <button
              type="button"
              onClick={onBookWithBliss}
              disabled={!canBook}
              className="text-lg text-slate-700 underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
            >
              Or pay in installments with <Bliss />
              {discountBasisPoints > 0 ? (
                <>
                  {" and "}
                  <span className="font-bold text-emerald-700">
                    save {Math.round(discountBasisPoints / 100)}%
                  </span>
                </>
              ) : null}
            </button>
          </div>
        </Card>

        <footer className="pt-4 pb-12 text-center text-xs text-[#1e2a3a]/45">
          The Hawthorn at Camden · 12 Bay Road, Camden, Maine
        </footer>
      </main>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-[#1e2a3a]/15 bg-white/70 p-6 shadow-sm backdrop-blur-sm">
      <h2 className="mb-4 font-serif text-xl text-[#2a4131]">{title}</h2>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs uppercase tracking-wider text-[#1e2a3a]/60">
        {label}
      </span>
      {children}
    </label>
  );
}

function Bliss() {
  return (
    <span style={{ fontFamily: "Georgia, serif", fontWeight: "bold" }}>Bliss</span>
  );
}

function ReadOnly({ value, emphasis = false }: { value: string; emphasis?: boolean }) {
  return (
    <div
      className={`w-full rounded border border-transparent bg-[#f7f1e6] px-3 py-2 ${
        emphasis ? "font-serif text-lg text-[#2a4131]" : "text-[#1e2a3a]/80"
      }`}
    >
      {value}
    </div>
  );
}
