"use client";

import { useState } from "react";
import {
  formatDollars,
  payNextInstallment,
  payRemainingBalance,
} from "@/lib/publicApi";

/**
 * Early-payment actions on the Next payment card. Closed it is a single
 * "Make a payment" pill; open it offers the two charges the plan supports —
 * the next installment, or the whole outstanding balance.
 *
 * Both amounts are passed in from the values the portal already computed
 * (nextDueAmountCents and remainingCents). Neither is recomputed here, and
 * neither is sent to the server: both endpoints take no body and derive the
 * amount themselves, so these figures are display only.
 */
export function PayEarlyButton({
  token,
  amount,
  remaining,
  onPaid,
}: {
  token: string;
  /** The next installment, from portal.nextDueAmountCents. */
  amount: number;
  /** The whole outstanding balance, from portal.remainingCents. */
  remaining: number;
  onPaid: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function charge(kind: "next" | "remaining") {
    setError(null);
    setBusy(true);
    const result =
      kind === "next"
        ? await payNextInstallment(token)
        : await payRemainingBalance(token);
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setOpen(false);
    await onPaid();
  }

  if (!open) {
    return (
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={busy}
          className="rounded-full bg-brand-violet p-[19px] text-center text-[17px] font-medium tracking-[-0.01em] text-white transition-colors hover:bg-brand-violet-deep disabled:cursor-not-allowed disabled:opacity-50"
        >
          Make a payment
        </button>
        {error ? (
          <div role="alert" className="text-xs text-red-700">
            {error}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="text-sm leading-[1.55] text-ink-400">
        Pay your next payment or your full balance.
      </div>
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => charge("next")}
          disabled={busy}
          className="rounded-full bg-brand-violet p-[19px] text-center text-[17px] font-medium tracking-[-0.01em] text-white transition-colors hover:bg-brand-violet-deep disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Charging…" : `Charge ${formatDollars(amount)}`}
        </button>
        <button
          type="button"
          onClick={() => charge("remaining")}
          disabled={busy}
          className="rounded-full border border-sand-500 p-[17px] text-center text-[17px] font-medium tracking-[-0.01em] text-brand-violet transition-colors hover:bg-sand-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Pay full balance {formatDollars(remaining)}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={busy}
          className="rounded-full p-[15px] text-center text-[15px] font-medium tracking-[-0.01em] text-ink-500 transition-colors hover:bg-sand-50 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
      {error ? (
        <div role="alert" className="text-xs text-red-700">
          {error}
        </div>
      ) : null}
    </div>
  );
}
