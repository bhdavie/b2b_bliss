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
      <div className="flex flex-col items-end gap-1">
        <button
          type="button"
          onClick={() => setConfirming(true)}
          disabled={busy}
          className="rounded-none bg-brand-purple px-5 py-3 text-sm font-medium text-white transition hover:bg-brand-purple-dark disabled:cursor-not-allowed disabled:opacity-50"
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
    <div className="flex flex-col items-end gap-2">
      <div className="text-xs text-ink-muted">
        Charge your card on file {formatDollars(amount)} now?
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={busy}
          className="rounded-none border border-brand-neutral px-3 py-2 text-xs text-ink-muted hover:bg-brand-lavender/10 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handlePay}
          disabled={busy}
          className="rounded-none bg-brand-purple px-4 py-2 text-xs font-medium text-white hover:bg-brand-purple-dark disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Charging…" : `Charge ${formatDollars(amount)}`}
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
