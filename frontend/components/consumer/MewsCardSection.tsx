"use client";

import { useRef, useState } from "react";
import { confirmMewsCard, requestMewsCard } from "@/lib/publicApi";

// Mews-rail card capture. Flow (mews inverts the Stripe order):
//   1. collect email, then the parent creates the pending_card plan
//      (paymentMethodId "mews_placeholder") and hands back the booking token
//   2. open a card collection request and load the Mews Payments Checkout embed
//   3. the embed's onSuccess vaults the card; we confirm server-side, which
//      charges the first installment and activates the plan, then advance to
//      the existing Confirmation.

const SCRIPT_SRC = "https://cdn.mews.com/payments/checkout-embed.js";
const CONTAINER_ID = "mews-payment-checkout";

type MewsGlobal = {
  PaymentCheckout: {
    load: (opts: {
      containerId: string;
      requestId: string;
      dataBaseUrl: string;
      onSuccess?: (event: MewsSuccessEvent) => void;
      onFailure?: (event: unknown) => void;
    }) => void;
  };
};

type MewsSuccessEvent = {
  paymentMethodId?: string;
  data?: { paymentMethodId?: string };
};

// Load the embed script once per page; subsequent calls reuse the promise.
let scriptPromise: Promise<void> | null = null;
function loadMewsScript(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Card entry is only available in the browser."));
  }
  if ((window as unknown as { Mews?: MewsGlobal }).Mews) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptPromise = null;
      reject(new Error("Could not load the secure card form. Check your connection and try again."));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

type Phase = "form" | "loading" | "embed" | "processing";

export type MewsCreateResult =
  | { ok: true; bookingToken: string }
  | { ok: false; message: string };

export function MewsCardSection({
  emailInitial,
  onCancel,
  onCreatePlan,
  onConfirmed,
  disclosure,
  ctaLabel,
  returnUrl,
  merchantName,
}: {
  emailInitial: string;
  onCancel: () => void;
  /** Parent creates the pending_card plan (with "mews_placeholder") and returns the token. */
  onCreatePlan: (email: string) => Promise<MewsCreateResult>;
  /** Called once the card is confirmed and the plan is activated. */
  onConfirmed: () => void;
  disclosure: string;
  ctaLabel: string;
  returnUrl?: string | null;
  merchantName?: string;
}) {
  const [email, setEmail] = useState(emailInitial);
  const [phase, setPhase] = useState<Phase>("form");
  const [error, setError] = useState<string | null>(null);
  const tokenRef = useRef<string | null>(null);

  const busy = phase === "loading" || phase === "processing";

  async function handleStart(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email.trim()) {
      setError("Email is required so we can send your plan details.");
      return;
    }
    setPhase("loading");

    const created = await onCreatePlan(email.trim());
    if (!created.ok) {
      setError(created.message);
      setPhase("form");
      return;
    }
    tokenRef.current = created.bookingToken;

    const request = await requestMewsCard(created.bookingToken);
    if (!request.ok) {
      setError(request.error.message);
      setPhase("form");
      return;
    }

    try {
      await loadMewsScript();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the secure card form.");
      setPhase("form");
      return;
    }

    const mews = (window as unknown as { Mews?: MewsGlobal }).Mews;
    if (!mews) {
      setError("The secure card form is unavailable right now. Try again shortly.");
      setPhase("form");
      return;
    }
    // The container is already in the DOM (rendered once phase left "form").
    mews.PaymentCheckout.load({
      containerId: CONTAINER_ID,
      requestId: request.data.requestId,
      dataBaseUrl: request.data.dataBaseUrl,
      onSuccess: (event) => {
        void handleEmbedSuccess(event);
      },
      onFailure: () => {
        setError("Card entry failed. Please check your details and try again.");
      },
    });
    setPhase("embed");
  }

  async function handleEmbedSuccess(event: MewsSuccessEvent) {
    const token = tokenRef.current;
    if (!token) return;
    const paymentMethodId = event?.paymentMethodId ?? event?.data?.paymentMethodId ?? "";
    setError(null);
    setPhase("processing");
    const confirm = await confirmMewsCard(token, paymentMethodId);
    if (confirm.ok) {
      onConfirmed();
      return;
    }
    // Confirm failed (e.g. declined). The plan is still pending; keep the embed
    // mounted so the guest can try another card.
    setError(confirm.error.message);
    setPhase("embed");
  }

  const showContainer = phase !== "form";

  return (
    <div className="mt-6 space-y-4">
      <SectionLabel>Payment method</SectionLabel>

      {phase === "form" ? (
        <form onSubmit={handleStart} className="space-y-4">
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
          {error ? (
            <div className="text-[12px] text-red-600" role="alert">
              {error}
            </div>
          ) : null}
          <p className="text-[11px] leading-relaxed text-brand-navy/60">{disclosure}</p>
          <div className="flex flex-col gap-2 pt-1">
            <button
              type="submit"
              className="w-full rounded-none bg-[#C9AFFA] px-6 py-3.5 text-[15px] font-medium text-white transition hover:bg-[#BBA0F4] disabled:opacity-60"
            >
              {ctaLabel}
            </button>
            <BackRow onCancel={onCancel} disabled={false} returnUrl={returnUrl} merchantName={merchantName} />
          </div>
        </form>
      ) : null}

      {showContainer ? (
        <>
          <div
            id={CONTAINER_ID}
            className="min-h-[180px] rounded-none border border-brand-neutral bg-white px-3 py-3.5"
          />
          {phase === "loading" ? (
            <p className="text-[12px] text-brand-navy/60">Loading the secure card form...</p>
          ) : null}
          {phase === "processing" ? (
            <p className="text-[12px] text-brand-navy/60">Confirming your card...</p>
          ) : null}
          {error ? (
            <div className="text-[12px] text-red-600" role="alert">
              {error}
            </div>
          ) : null}
          <p className="text-[11px] leading-relaxed text-brand-navy/60">{disclosure}</p>
          <BackRow onCancel={onCancel} disabled={busy} returnUrl={returnUrl} merchantName={merchantName} />
        </>
      ) : null}
    </div>
  );
}

function BackRow({
  onCancel,
  disabled,
  returnUrl,
  merchantName,
}: {
  onCancel: () => void;
  disabled: boolean;
  returnUrl?: string | null;
  merchantName?: string;
}) {
  return (
    <div className="flex items-center justify-center gap-3 text-[12px] text-brand-navy/60">
      <button type="button" onClick={onCancel} disabled={disabled} className="text-brand-navy/60 hover:text-brand-purple hover:underline disabled:opacity-60">
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
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-medium uppercase tracking-[0.6px] text-brand-navy/60">
      {children}
    </div>
  );
}
