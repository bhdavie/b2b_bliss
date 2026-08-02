"use client";

import { useState } from "react";
import { formatDollars, payNextInstallment } from "@/lib/publicApi";

export function PayEarlyButton({
  token,
  amount,
  onPaid,
}: {
  token: string;
  amount: number;
  onPaid: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePay() {
    setError(null);
    setBusy(true);
    const result = await payNextInstallment(token);
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      setConfirming(false);
      return;
    }
    setConfirming(false);
    await onPaid();
  }

  if (!confirming) {
    return (
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => setConfirming(true)}
          disabled={busy}
          className="rounded-full bg-brand-violet p-[19px] text-center text-[17px] font-medium tracking-[-0.01em] text-white transition-colors hover:bg-brand-violet-deep disabled:cursor-not-allowed disabled:opacity-50"
        >
          Pay early
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
        Charge your card on file {formatDollars(amount)} now?
      </div>
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={handlePay}
          disabled={busy}
          className="rounded-full bg-brand-violet p-[19px] text-center text-[17px] font-medium tracking-[-0.01em] text-white transition-colors hover:bg-brand-violet-deep disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Charging…" : `Charge ${formatDollars(amount)}`}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={busy}
          className="rounded-full border border-sand-500 p-[15px] text-center text-[15px] font-medium tracking-[-0.01em] text-ink-500 transition-colors hover:bg-sand-50 disabled:opacity-50"
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
