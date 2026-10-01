"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { resyncMews, setBlissRateBookingType } from "@/lib/api";

/** "Resync now": reads the property's setup from Mews again, then refreshes the card. */
export function ResyncMewsButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  async function resync() {
    setMessage(null);
    const result = await resyncMews();
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    startTransition(() => router.refresh());
    setMessage("Synced with Mews.");
  }

  return (
    <div className="flex items-center gap-[10px]">
      <button
        type="button"
        onClick={resync}
        disabled={pending}
        className="rounded-full border border-sand-200 px-[14px] py-[6px] text-[13px] text-ink-900 disabled:opacity-60"
      >
        Resync now
      </button>
      {message ? <span className="text-[13px] text-ink-500">{message}</span> : null}
    </div>
  );
}

/**
 * A Bliss rate's booking type: follow Mews (the default), or the hotel's own
 * choice. Saves on change and refreshes the card.
 */
export function BookingTypeSelect({
  rateId,
  followsMews,
  value,
}: {
  rateId: string;
  followsMews: boolean;
  value: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const current = followsMews ? "follow" : value;

  async function change(next: string) {
    setError(null);
    const result = await setBlissRateBookingType(
      rateId,
      next === "follow" ? null : (next as "refundable" | "non_refundable"),
    );
    if (!result.ok) {
      setError(result.message);
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <div className="flex flex-col gap-[4px] sm:items-end">
      <select
        aria-label="Booking type"
        value={current}
        disabled={pending}
        onChange={(e) => change(e.target.value)}
        className="rounded-[8px] border border-sand-200 bg-white px-[10px] py-[6px] text-[13px] text-ink-900"
      >
        <option value="follow">Follow Mews</option>
        <option value="refundable">Refundable</option>
        <option value="non_refundable">Non-refundable</option>
      </select>
      {error ? <span className="text-[12px] text-ink-500">{error}</span> : null}
    </div>
  );
}
