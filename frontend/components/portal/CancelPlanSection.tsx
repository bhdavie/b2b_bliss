"use client";

import { useState } from "react";
import { cancelPlan, formatDollars } from "@/lib/publicApi";

// Policy-gated cancel. Refundability is derived from the rate name in the
// booking's service name (advance/non-refundable vs flexible) for now; the
// refund figure is COMPUTED and DISPLAYED only. No Stripe refund is executed.
// Confirming calls the backend cancel endpoint, which transitions the plan to
// cancelled and stops the remaining installments.

type Refundability = "flexible" | "nonrefundable";

function deriveRefundability(serviceName: string): Refundability {
  return /advance purchase|non[- ]?refundable/i.test(serviceName)
    ? "nonrefundable"
    : "flexible";
}

function moreThan48hAway(appointmentDateIso: string): boolean {
  const [y, m, d] = appointmentDateIso.split("-").map(Number);
  const arrival = new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1).getTime();
  return arrival - Date.now() > 48 * 60 * 60 * 1000;
}

export function CancelPlanSection({
  token,
  serviceName,
  appointmentDate,
  paidCents,
  processingFeeCents,
  onCanceled,
}: {
  token: string;
  serviceName: string;
  appointmentDate: string;
  paidCents: number;
  processingFeeCents: number;
  onCanceled: () => void | Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refundability = deriveRefundability(serviceName);
  const inWindow = moreThan48hAway(appointmentDate);

  // Non-refundable rate: cancel is not offered.
  if (refundability === "nonrefundable") {
    return (
      <div className="space-y-2">
        <p className="text-sm text-ink">
          This rate is non-refundable per the hotel&apos;s policy.
        </p>
        <p className="text-sm text-ink-muted">
          The amount already paid is not returned, so this plan cannot be
          cancelled here. Reach out to the hotel directly with any questions.
        </p>
        <button
          type="button"
          disabled
          className="rounded-none border border-brand-neutral bg-white px-4 py-2 text-sm font-medium text-ink-muted opacity-60"
        >
          Cancel plan
        </button>
      </div>
    );
  }

  // Flexible rate: full refund including the Bliss fee when in window; out of
  // window the refund follows the hotel policy and the Bliss fee is withheld.
  const refundCents = inWindow
    ? paidCents
    : Math.max(0, paidCents - processingFeeCents);

  async function confirmCancel() {
    setBusy(true);
    setError(null);
    const res = await cancelPlan(token);
    setBusy(false);
    if (!res.ok) {
      setError(res.error.message);
      return;
    }
    await onCanceled();
  }

  if (!confirming) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-ink-muted">
          {inWindow
            ? "You are more than 48 hours before arrival, so cancelling returns your full payment."
            : "You are within 48 hours of arrival. Your refund follows the hotel's policy and the Bliss processing fee is not returned."}
        </p>
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="rounded-none border border-brand-purple bg-white px-4 py-2 text-sm font-medium text-brand-purple transition-colors hover:bg-brand-lavender/15"
        >
          Cancel plan
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-none border border-brand-lavender bg-brand-lavender/10 p-4">
      <div>
        <div className="text-[11px] uppercase tracking-[0.18em] text-ink-muted">
          Refund {inWindow ? "(includes the Bliss fee)" : "(per the hotel policy)"}
        </div>
        <div className="mt-1 text-2xl font-semibold tabular-nums text-brand-navy">
          {formatDollars(refundCents)}
        </div>
      </div>
      <p className="text-xs text-ink-muted">
        Cancelling stops every remaining installment. This figure is what you
        are due back. We will sort the refund out for you.
      </p>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={confirmCancel}
          disabled={busy}
          className="rounded-none bg-brand-purple px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-purple-dark disabled:opacity-60"
        >
          {busy ? "Cancelling" : "Confirm cancellation"}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={busy}
          className="rounded-none border border-brand-neutral bg-white px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-brand-neutral/20"
        >
          Keep my plan
        </button>
      </div>
    </div>
  );
}
