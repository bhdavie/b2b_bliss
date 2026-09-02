"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { cancelPlan, refundPlan } from "@/lib/api";
import { formatDollars } from "@/lib/publicApi";
import { Button } from "@/components/ui/Button";
import { Panel, SectionHeading } from "@/components/ui/primitives";

type Kind = "cancel" | "refund";

// Manager overrides on the booking detail page. Cancel and Refund deliberately
// supersede the cancellation/refund policy — they write the shared plan record
// (the same one the guest portal reads), so the change shows on both sides.
export function ManagerActions({
  planId,
  planStatus,
  refunded,
  refundAmountCents,
  paidCents,
}: {
  planId: string;
  planStatus: string;
  refunded: boolean;
  refundAmountCents: number | null;
  paidCents: number;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState<Kind | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cancelled = planStatus === "canceled";

  async function run(kind: Kind) {
    setBusy(true);
    setError(null);
    try {
      if (kind === "cancel") await cancelPlan(planId);
      else await refundPlan(planId);
      setConfirming(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel variant="filled" className="p-5">
      <SectionHeading className="mb-4">Manage booking</SectionHeading>
      <p className="text-[14px] leading-[1.4] text-ink-500">
        Manager overrides. These supersede the booking&apos;s cancellation and
        refund policy and apply immediately.
      </p>

      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => setConfirming("cancel")}
          disabled={cancelled}
          className="inline-flex items-center justify-center rounded-md border border-brand-purple px-4 py-2.5 text-[13px] text-brand-purple transition-colors hover:bg-brand-lavender/15 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {cancelled ? "Booking cancelled" : "Cancel booking"}
        </button>
        <button
          type="button"
          onClick={() => setConfirming("refund")}
          disabled={cancelled || refunded}
          className="inline-flex items-center justify-center rounded-md border border-brand-purple px-4 py-2.5 text-[13px] text-brand-purple transition-colors hover:bg-brand-lavender/15 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {refunded ? `Refunded ${formatDollars(refundAmountCents ?? 0)}` : "Refund"}
        </button>
      </div>

      {error ? (
        <p className="mt-3 text-[13px] text-red-600" role="alert">
          {error}
        </p>
      ) : null}

      {confirming ? (
        <ConfirmDialog
          kind={confirming}
          amount={paidCents}
          busy={busy}
          onConfirm={() => run(confirming)}
          onClose={() => (busy ? undefined : setConfirming(null))}
        />
      ) : null}
    </Panel>
  );
}

function ConfirmDialog({
  kind,
  amount,
  busy,
  onConfirm,
  onClose,
}: {
  kind: Kind;
  amount: number;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const copy =
    kind === "cancel"
      ? {
          title: "Cancel this booking?",
          body: "The guest's plan ends and every remaining charge stops. This overrides the cancellation policy and can't be undone here. The guest sees the cancellation in their account.",
          confirm: "Yes, cancel booking",
        }
      : {
          title: `Refund ${formatDollars(amount)} to the guest?`,
          body: "This records a full refund of everything paid so far and overrides the refund policy. It's simulated for the demo (no real charge is reversed) and shows on the guest's plan immediately.",
          confirm: `Yes, refund ${formatDollars(amount)}`,
        };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-brand-navy/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-label={copy.title}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !busy) onClose();
      }}
    >
      <div className="w-full max-w-md border border-brand-neutral bg-white p-6 shadow-elevated-lg">
        <h3 className="text-[14px] font-bold text-ink-900">{copy.title}</h3>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-500">{copy.body}</p>
        <div className="mt-5 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md px-4 py-2.5 text-[13px] text-ink-500 transition-colors hover:text-ink-900 disabled:opacity-50"
          >
            Keep it
          </button>
          <Button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            autoFocus
            variant="merchant"
          >
            {busy ? "Working…" : copy.confirm}
          </Button>
        </div>
      </div>
    </div>
  );
}
