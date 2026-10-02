"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  resyncMews,
  setBlissRateBookingType,
  updateBlissSettings,
  type BlissSetting,
  type BlissSettingsUpdate,
} from "@/lib/api";

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

/** Settings the hotel changes right here; plan settings are changed in the tabs below. */
const EDITABLE_HERE = new Set([
  "payoutMode",
  "releasePolicy",
  "chargebackBufferDays",
  "feeTaxCode",
  "ledgerPaymentType",
  "weeklySummary",
]);

export function isEditableHere(s: BlissSetting): boolean {
  return s.editable && EDITABLE_HERE.has(s.key);
}

/**
 * One of the hotel's own Bliss choices, edited in place: a list for settings
 * with options, a field for the rest. Saves on "Save" (or on change for a list)
 * and refreshes the card.
 */
export function BlissSettingEditor({ setting }: { setting: BlissSetting }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState(setting.value == null ? "" : String(setting.value));
  const [error, setError] = useState<string | null>(null);

  async function save(value: string) {
    setError(null);
    const update: BlissSettingsUpdate =
      setting.key === "chargebackBufferDays"
        ? { chargebackBufferDays: Number(value) }
        : { [setting.key]: value };
    const result = await updateBlissSettings(update);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    startTransition(() => router.refresh());
  }

  if (setting.options) {
    return (
      <div className="flex flex-col gap-[4px] sm:items-end">
        <select
          aria-label={setting.label}
          value={String(setting.value)}
          disabled={pending}
          onChange={(e) => save(e.target.value)}
          className="rounded-[8px] border border-sand-200 bg-white px-[10px] py-[6px] text-[13px] text-ink-900"
        >
          {setting.options.map((o) => (
            <option key={o.value} value={o.value} disabled={!o.available}>
              {o.label}
              {o.note ? ` (${o.note})` : ""}
            </option>
          ))}
        </select>
        {error ? <span className="text-[12px] text-danger">{error}</span> : null}
      </div>
    );
  }

  const numeric = setting.key === "chargebackBufferDays";
  const changed = draft !== (setting.value == null ? "" : String(setting.value));
  return (
    <div className="flex flex-col gap-[4px] sm:items-end">
      <div className="flex items-center gap-[8px]">
        <input
          aria-label={setting.label}
          type={numeric ? "number" : "text"}
          min={numeric ? 0 : undefined}
          max={numeric ? 30 : undefined}
          value={draft}
          placeholder={setting.key === "feeTaxCode" ? "Untaxed" : "Not chosen yet"}
          disabled={pending}
          onChange={(e) => setDraft(e.target.value)}
          className="w-[160px] rounded-[8px] border border-sand-200 bg-white px-[10px] py-[6px] text-[13px] text-ink-900"
        />
        <button
          type="button"
          onClick={() => save(draft)}
          disabled={pending || !changed}
          className="rounded-full border border-sand-200 px-[12px] py-[6px] text-[13px] text-ink-900 disabled:opacity-60"
        >
          Save
        </button>
      </div>
      {error ? <span className="text-[12px] text-danger">{error}</span> : null}
    </div>
  );
}
