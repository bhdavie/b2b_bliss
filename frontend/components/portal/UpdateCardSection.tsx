"use client";

import { useState } from "react";
import { replacePaymentMethod } from "@/lib/publicApi";

/**
 * Replace the saved card on a plan. Branches once on
 * {@code stripeConfigured}: real arm would mount Stripe Elements + a
 * SetupIntent confirm; demo arm uses a plain form and synthesizes a
 * pm_demo_* id. For the current demo we only ship the demo arm — the
 * real arm is a placeholder that surfaces the SetupIntent client_secret
 * fetch but stops short of mounting Stripe.js (out of scope for the
 * current build; the portal still renders, just with a "card update
 * requires Stripe configuration" notice).
 */
export function UpdateCardSection({
  token,
  stripeConfigured,
  stripePublishableKey,
  onReplaced,
}: {
  token: string;
  stripeConfigured: boolean;
  stripePublishableKey: string | null;
  onReplaced: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cardNumber, setCardNumber] = useState("4242 4242 4242 4242");
  const [expiry, setExpiry] = useState("12/30");
  const [zip, setZip] = useState("12345");

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm font-medium text-brand-purple underline-offset-2 hover:underline"
      >
        Update card
      </button>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (stripeConfigured && stripePublishableKey) {
      setError(
        "Card update via Stripe Elements is not yet wired in this build. Disable Stripe or update through the merchant.",
      );
      return;
    }

    const digits = cardNumber.replace(/\D+/g, "");
    const lastFour = digits.slice(-4).padStart(4, "0");
    const [mm, yy] = expiry.split("/").map((s) => s.trim());
    const expMonth = parseInt(mm ?? "12", 10) || 12;
    const yyNum = parseInt(yy ?? "30", 10);
    const expYear = Number.isFinite(yyNum) ? (yyNum < 100 ? 2000 + yyNum : yyNum) : 2030;
    const brand = inferBrand(digits);

    setBusy(true);
    const result = await replacePaymentMethod(token, {
      paymentMethodId: `pm_demo_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
      demoCardLastFour: lastFour,
      demoCardExpMonth: expMonth,
      demoCardExpYear: expYear,
      demoCardBrand: brand,
    });
    setBusy(false);

    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setOpen(false);
    await onReplaced();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded border border-brand-lavender bg-white p-4">
      <div className="text-xs uppercase tracking-[0.18em] text-ink-muted">
        Replace card
      </div>
      <label className="block">
        <span className="text-xs text-ink-muted">Card number</span>
        <input
          type="text"
          value={cardNumber}
          onChange={(e) => setCardNumber(e.target.value)}
          inputMode="numeric"
          autoComplete="cc-number"
          className="mt-1 w-full rounded border border-brand-neutral bg-white px-3 py-2 text-sm tabular-nums focus:border-brand-navy focus:outline-none"
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs text-ink-muted">Expiry</span>
          <input
            type="text"
            value={expiry}
            onChange={(e) => setExpiry(e.target.value)}
            inputMode="numeric"
            autoComplete="cc-exp"
            className="mt-1 w-full rounded border border-brand-neutral bg-white px-3 py-2 text-sm tabular-nums focus:border-brand-navy focus:outline-none"
          />
        </label>
        <label className="block">
          <span className="text-xs text-ink-muted">ZIP</span>
          <input
            type="text"
            value={zip}
            onChange={(e) => setZip(e.target.value)}
            inputMode="numeric"
            autoComplete="postal-code"
            className="mt-1 w-full rounded border border-brand-neutral bg-white px-3 py-2 text-sm tabular-nums focus:border-brand-navy focus:outline-none"
          />
        </label>
      </div>
      {error ? (
        <div role="alert" className="text-xs text-red-700">
          {error}
        </div>
      ) : null}
      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={busy}
          className="rounded border border-brand-neutral px-3 py-2 text-xs text-ink-muted hover:bg-brand-lavender/10 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={busy}
          className="rounded bg-brand-purple px-4 py-2 text-xs font-medium text-white hover:bg-brand-purple-dark disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save new card"}
        </button>
      </div>
    </form>
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
