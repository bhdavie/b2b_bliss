"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { resumeDisputedPayments } from "@/lib/api";

/** Lets a plan's automatic payments resume although its card dispute was lost (or is still open). */
export function ResumePaymentsButton({ disputeId }: { disputeId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function resume() {
    setBusy(true);
    setError(null);
    try {
      await resumeDisputedPayments(disputeId);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not resume payments.");
      setBusy(false);
    }
  }

  return (
    <span className="flex flex-col items-end gap-0.5">
      <button
        type="button"
        onClick={resume}
        disabled={busy}
        className="rounded-full border border-sand-200 px-[12px] py-[4px] text-[12px] text-ink-900 disabled:opacity-60"
      >
        {busy ? "Resuming" : "Resume payments"}
      </button>
      {error ? <span className="text-[12px] text-danger">{error}</span> : null}
    </span>
  );
}
