"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cancelPlan, formatDollars } from "@/lib/publicApi";
import { Button } from "@/components/ui/Button";

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
}: {
  token: string;
  serviceName: string;
  appointmentDate: string;
  paidCents: number;
  processingFeeCents: number;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refundability = deriveRefundability(serviceName);
  const inWindow = moreThan48hAway(appointmentDate);

  // Non-refundable rate: cancel is not offered.
  if (refundability === "nonrefundable") {
    return (
      <div className="space-y-2">
        <p className="text-sm text-ink-700">
          This rate is non-refundable per the hotel&apos;s policy.
        </p>
        <p className="text-sm text-ink-500">
          The amount already paid is not returned, so this plan cannot be
          cancelled here. Reach out to the hotel directly with any questions.
        </p>
        <Button type="button" disabled variant="ghost" className="opacity-60">
          Cancel plan
        </Button>
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
    let res;
    try {
      res = await cancelPlan(token);
    } catch {
      // Genuine network failure unrelated to the plan state.
      setBusy(false);
      setError("Something went wrong. Please check your connection and try again.");
      return;
    }
    // A 404 (plan no longer active) or 409 means the plan is already cancelled.
    // Treat that as success and route to history the same way, so the guest
    // never sees a raw "plan not found" string.
    const alreadyCancelled =
      !res.ok && (res.status === 404 || res.status === 409);
    if (res.ok || alreadyCancelled) {
      // Keep busy true so the buttons stay disabled through navigation.
      router.push(`/account/history?canceled=${encodeURIComponent(token)}`);
      return;
    }
    setBusy(false);
    setError("We could not cancel this plan. Please try again.");
  }

  if (!confirming) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-ink-500">
          {inWindow
            ? "You are more than 48 hours before arrival, so cancelling returns your full payment."
            : "You are within 48 hours of arrival. Your refund follows the hotel's policy and the Bliss processing fee is not returned."}
        </p>
        <Button
          type="button"
          onClick={() => setConfirming(true)}
          variant="ghost"
        >
          Cancel plan
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-sand-200 bg-sand-50 p-4">
      <div>
        <div className="text-[11px] text-ink-400">
          Refund {inWindow ? "(includes the Bliss fee)" : "(per the hotel policy)"}
        </div>
        <div className="mt-1 text-2xl font-semibold tabular-nums text-ink-900">
          {formatDollars(refundCents)}
        </div>
      </div>
      <p className="text-xs text-ink-500">
        Cancelling stops every remaining installment. This figure is what you
        are due back. We will sort the refund out for you.
      </p>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <div className="flex gap-2">
        <Button
          type="button"
          onClick={confirmCancel}
          disabled={busy}
          variant="primary"
        >
          {busy ? "Cancelling" : "Confirm cancellation"}
        </Button>
        <Button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={busy}
          variant="ghost"
        >
          Keep my plan
        </Button>
      </div>
    </div>
  );
}
