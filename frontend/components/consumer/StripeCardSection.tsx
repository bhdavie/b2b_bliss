"use client";

import { CardElement, useElements, useStripe } from "@stripe/react-stripe-js";
import type { StripeCardElementOptions } from "@stripe/stripe-js";
import { useState } from "react";

// Styles mirror the brand token system so the Stripe iframe blends in
// with the rest of the hosted page.
const CARD_OPTIONS: StripeCardElementOptions = {
  style: {
    base: {
      fontSize: "15px",
      color: "#111111",
      fontFamily:
        "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
      "::placeholder": { color: "#6B6B6B" },
      iconColor: "#51576A",
    },
    invalid: {
      color: "#b91c1c",
      iconColor: "#b91c1c",
    },
  },
};

export type CollectedCard = {
  paymentMethodId: string;
  email: string;
};

export function StripeCardSection({
  emailInitial,
  onCancel,
  onCardCollected,
  busy,
  disclosure,
  ctaLabel,
  returnUrl,
  merchantName,
}: {
  emailInitial: string;
  onCancel: () => void;
  onCardCollected: (card: CollectedCard) => Promise<void>;
  busy: boolean;
  disclosure: string;
  ctaLabel: string;
  returnUrl?: string | null;
  merchantName?: string;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [email, setEmail] = useState(emailInitial);
  const [error, setError] = useState<string | null>(null);
  const [cardReady, setCardReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const disabled = !stripe || !elements || !cardReady || busy || submitting;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!stripe || !elements) return;
    const card = elements.getElement(CardElement);
    if (!card) {
      setError("Card form is not ready yet.");
      return;
    }
    if (!email.trim()) {
      setError("Email is required so we can send your plan details.");
      return;
    }
    setSubmitting(true);
    const { paymentMethod, error: pmError } = await stripe.createPaymentMethod({
      type: "card",
      card,
      billing_details: { email: email.trim() },
    });
    if (pmError || !paymentMethod) {
      setError(pmError?.message ?? "Could not read your card details.");
      setSubmitting(false);
      return;
    }
    try {
      await onCardCollected({
        paymentMethodId: paymentMethod.id,
        email: email.trim(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Plan setup failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-6 space-y-4">
      <SectionLabel>Payment method</SectionLabel>
      <label className="block">
        <span className="text-[12px] text-brand-navy/60">Email</span>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1.5 w-full rounded-none border border-brand-neutral bg-white px-3 py-2.5 text-[15px] placeholder:text-brand-navy/40 focus:border-brand-purple focus:outline-none focus:ring-2 focus:ring-brand-lavender/40"
          placeholder="you@example.com"
          autoComplete="email"
        />
      </label>
      <label className="block">
        <span className="text-[12px] text-brand-navy/60">Card</span>
        <div className="mt-1.5 rounded-none border border-brand-neutral bg-white px-3 py-3.5 focus-within:border-brand-purple focus-within:ring-2 focus-within:ring-brand-lavender/40">
          <CardElement
            options={CARD_OPTIONS}
            onChange={(event) => {
              setCardReady(event.complete);
              setError(event.error?.message ?? null);
            }}
          />
        </div>
      </label>

      {error ? (
        <div className="text-[12px] text-red-600" role="alert">
          {error}
        </div>
      ) : null}

      <p className="text-[11px] leading-relaxed text-brand-navy/60">{disclosure}</p>

      <div className="flex flex-col gap-2 pt-1">
        <button
          type="submit"
          disabled={disabled}
          className="w-full rounded-none bg-[#C9AFFA] px-6 py-3.5 text-[15px] font-medium text-white transition hover:bg-[#BBA0F4] disabled:opacity-60"
        >
          {submitting || busy ? "Setting up plan..." : ctaLabel}
        </button>
        <div className="flex items-center justify-center gap-3 text-[12px] text-brand-navy/60">
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting || busy}
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

export function StripeNotConfiguredCard() {
  return (
    <section className="mt-6 rounded-none border border-amber-200 bg-amber-50 p-4 text-[13px] text-amber-900">
      <div className="font-medium">Stripe is not configured</div>
      <p className="mt-1 text-[12px] leading-relaxed text-amber-800">
        The merchant has not finished wiring payments yet. Reach out to them
        directly to arrange this booking, or check back shortly.
      </p>
    </section>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-medium uppercase tracking-[0.6px] text-brand-navy/60">
      {children}
    </div>
  );
}
