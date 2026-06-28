"use client";

import { useState } from "react";

/**
 * Demo stand-in for {@link StripeCardSection}. Renders the same visual
 * layout — email, card number, expiry, CVC, ZIP — but with plain inputs
 * and no Stripe integration. Defaults are pre-populated so the demo is
 * click-through ready; submitting just calls onDemoSubmit so the parent
 * can synthesize a confirmation and advance.
 */
export type DemoCardSubmission = {
  email: string;
  lastFour: string;
  expMonth: number;
  expYear: number;
  brand: string;
};

export function DemoCardSection({
  emailInitial,
  onCancel,
  onDemoSubmit,
  busy,
  disclosure,
  ctaLabel,
  returnUrl,
  merchantName,
}: {
  emailInitial: string;
  onCancel: () => void;
  onDemoSubmit: (card: DemoCardSubmission) => void;
  busy: boolean;
  disclosure: string;
  ctaLabel: string;
  returnUrl?: string | null;
  merchantName?: string;
}) {
  const [email, setEmail] = useState(emailInitial);
  const [cardNumber, setCardNumber] = useState("4242 4242 4242 4242");
  const [expiry, setExpiry] = useState("12/30");
  const [cvc, setCvc] = useState("123");
  const [zip, setZip] = useState("12345");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const digits = cardNumber.replace(/\D+/g, "");
    const lastFour = digits.slice(-4).padStart(4, "0");
    const brand = inferBrand(digits);
    const [mm, yy] = expiry.split("/").map((s) => s.trim());
    const expMonth = parseInt(mm ?? "12", 10) || 12;
    const yyNum = parseInt(yy ?? "30", 10);
    const expYear = Number.isFinite(yyNum) ? (yyNum < 100 ? 2000 + yyNum : yyNum) : 2030;
    onDemoSubmit({ email, lastFour, expMonth, expYear, brand });
  }

  return (
    <form onSubmit={handleSubmit} className="mt-6 space-y-4">
      <SectionLabel>Payment method</SectionLabel>
      <label className="block">
        <span className="text-[12px] text-ink-muted">Email</span>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1.5 w-full rounded-md border border-brand-neutral bg-white px-3 py-2.5 text-[15px] placeholder:text-ink-muted focus:border-brand-navy focus:outline-none focus:ring-2 focus:ring-brand-lavender/60"
          placeholder="you@example.com"
          autoComplete="email"
        />
      </label>
      <label className="block">
        <span className="text-[12px] text-ink-muted">Card number</span>
        <input
          type="text"
          value={cardNumber}
          onChange={(e) => setCardNumber(e.target.value)}
          className="mt-1.5 w-full rounded-md border border-brand-neutral bg-white px-3 py-3.5 text-[15px] tabular-nums placeholder:text-ink-muted focus:border-brand-navy focus:outline-none focus:ring-2 focus:ring-brand-lavender/60"
          inputMode="numeric"
          autoComplete="cc-number"
        />
      </label>
      <div className="grid grid-cols-3 gap-3">
        <label className="block">
          <span className="text-[12px] text-ink-muted">Expiry</span>
          <input
            type="text"
            value={expiry}
            onChange={(e) => setExpiry(e.target.value)}
            className="mt-1.5 w-full rounded-md border border-brand-neutral bg-white px-3 py-3.5 text-[15px] tabular-nums placeholder:text-ink-muted focus:border-brand-navy focus:outline-none focus:ring-2 focus:ring-brand-lavender/60"
            autoComplete="cc-exp"
          />
        </label>
        <label className="block">
          <span className="text-[12px] text-ink-muted">CVC</span>
          <input
            type="text"
            value={cvc}
            onChange={(e) => setCvc(e.target.value)}
            className="mt-1.5 w-full rounded-md border border-brand-neutral bg-white px-3 py-3.5 text-[15px] tabular-nums placeholder:text-ink-muted focus:border-brand-navy focus:outline-none focus:ring-2 focus:ring-brand-lavender/60"
            inputMode="numeric"
            autoComplete="cc-csc"
          />
        </label>
        <label className="block">
          <span className="text-[12px] text-ink-muted">ZIP</span>
          <input
            type="text"
            value={zip}
            onChange={(e) => setZip(e.target.value)}
            className="mt-1.5 w-full rounded-md border border-brand-neutral bg-white px-3 py-3.5 text-[15px] tabular-nums placeholder:text-ink-muted focus:border-brand-navy focus:outline-none focus:ring-2 focus:ring-brand-lavender/60"
            inputMode="numeric"
            autoComplete="postal-code"
          />
        </label>
      </div>

      <p className="text-[11px] leading-relaxed text-ink-muted">{disclosure}</p>

      <div className="flex flex-col gap-2 pt-1">
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-md bg-brand-purple px-4 py-3.5 text-[15px] font-medium text-white transition-colors hover:bg-brand-purple-dark disabled:opacity-60"
        >
          {busy ? "Setting up plan..." : ctaLabel}
        </button>
        <div className="flex items-center justify-center gap-3 text-[12px] text-ink-muted">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="hover:underline"
          >
            Back to plan options
          </button>
          {returnUrl && merchantName ? (
            <>
              <span aria-hidden="true">·</span>
              <a href={returnUrl} className="hover:underline">
                Return to {merchantName}
              </a>
            </>
          ) : null}
        </div>
      </div>
    </form>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-medium uppercase tracking-[0.6px] text-ink-muted">
      {children}
    </div>
  );
}

function inferBrand(digits: string): string {
  if (digits.length === 0) return "visa";
  const first = digits[0];
  if (first === "4") return "visa";
  if (first === "5" || first === "2") return "mastercard";
  if (first === "3") return "amex";
  if (first === "6") return "discover";
  return "visa";
}
