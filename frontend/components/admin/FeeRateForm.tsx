"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { setAdminFeeRate } from "@/lib/api";

/**
 * The one client component on these screens. Everything else is a server
 * component reading through adminSessionHeader().
 *
 * The field takes a PERCENTAGE ("5" means 5%), because that is how a rate is
 * spoken about and written in a contract. The API takes a decimal, so this
 * divides by 100 before posting and prints the exact decimal it will send
 * underneath the input. That readout is the guard against the 10x error: 5 and
 * 0.05 both look plausible in a box labelled "rate", and the only way to be
 * sure which one is going over the wire is to show it.
 */
export function FeeRateForm({ merchantId }: { merchantId: string }) {
  const router = useRouter();
  const [percent, setPercent] = useState("");
  const [note, setNote] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const parsed = parsePercent(percent);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setDone(null);
    if (parsed === null) {
      setError("Enter a percentage, for example 5 for 5% or 0 to waive the fee.");
      return;
    }
    setSubmitting(true);
    try {
      const created = await setAdminFeeRate(merchantId, {
        rate: parsed.decimal,
        note: note.trim() ? note.trim() : null,
        // Blank means now, which the backend fills in. datetime-local has no
        // zone, so it is read as local time and converted to an instant here
        // rather than shipping an ambiguous string.
        effectiveFrom: effectiveFrom
          ? new Date(effectiveFrom).toISOString()
          : null,
      });
      setDone(
        `Set to ${formatDecimal(created.rate)} effective ${new Date(
          created.effectiveFrom,
        ).toLocaleString()}.`,
      );
      setPercent("");
      setNote("");
      setEffectiveFrom("");
      // Re-fetch the server components so the current rate, the history and
      // the list behind it all reflect the new row.
      router.refresh();
    } catch (err) {
      setError(messageFor(err instanceof Error ? err.message : "unknown"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[160px_minmax(0,1fr)]">
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] uppercase tracking-[0.08em] text-ink-500">
            New rate (%)
          </span>
          <Input
            value={percent}
            onChange={(e) => setPercent(e.target.value)}
            inputMode="decimal"
            placeholder="5"
            aria-describedby="fee-rate-readout"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] uppercase tracking-[0.08em] text-ink-500">
            Note (optional)
          </span>
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Why this rate changed"
          />
        </label>
      </div>

      {/* The exact decimal that will be posted. Shown always, so the number is
          visible before submit rather than discovered afterwards. */}
      <p id="fee-rate-readout" className="text-[13px] text-ink-500">
        {parsed === null ? (
          percent.trim() === "" ? (
            <>Enter a percentage. 5 means 5%. Enter 0 to waive the fee entirely.</>
          ) : (
            <>That is not a number this can send.</>
          )
        ) : (
          <>
            Will send{" "}
            <span className="font-medium text-ink-900">
              rate: {formatDecimal(parsed.decimal)}
            </span>{" "}
            ({parsed.label}). The API takes a decimal fraction, not a percentage.
          </>
        )}
      </p>

      <label className="flex flex-col gap-1.5 sm:max-w-[320px]">
        <span className="text-[12px] uppercase tracking-[0.08em] text-ink-500">
          Effective from (optional)
        </span>
        <Input
          type="datetime-local"
          value={effectiveFrom}
          onChange={(e) => setEffectiveFrom(e.target.value)}
        />
        <span className="text-[13px] text-ink-500">
          Leave blank for now. Must not be earlier than the most recent rate
          below.
        </span>
      </label>

      {error ? (
        <p className="text-[13px] text-red-700" role="alert">
          {error}
        </p>
      ) : null}
      {done ? <p className="text-[13px] text-ink-900">{done}</p> : null}

      <div>
        <Button type="submit" variant="primary" disabled={submitting}>
          {submitting ? "Saving" : "Set rate"}
        </Button>
      </div>
    </form>
  );
}

/**
 * Reads the field as a percentage. Returns null for anything that is not a
 * finite non-negative number, so the caller can refuse to post rather than
 * sending NaN.
 */
function parsePercent(raw: string): { decimal: number; label: string } | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const pct = Number(trimmed);
  if (!Number.isFinite(pct) || pct < 0) return null;
  // Round the decimal to 5 places, matching numeric(6,5) on the column, so the
  // readout is exactly what the database will hold.
  const decimal = Math.round((pct / 100) * 100000) / 100000;
  return { decimal, label: pct === 0 ? "no fee" : `${pct}%` };
}

/** Prints the decimal at the column's own scale, so 0.05 reads as 0.05000. */
function formatDecimal(decimal: number): string {
  return decimal.toFixed(5);
}

/**
 * The backend's distinct error keys, in its own terms. Anything unrecognised
 * falls through to the key itself rather than a generic apology, so an
 * unmapped case is still diagnosable from the screen.
 */
function messageFor(key: string): string {
  switch (key) {
    case "rate_required":
      return "A rate is required.";
    case "rate_out_of_range":
      return "The rate must be between 0% and 25%.";
    case "effective_from_invalid":
      return "That effective-from date could not be read.";
    case "effective_from_before_latest":
      return (
        "That effective-from date is earlier than the most recent rate already "
        + "on record. Rates are append-only, so a new one cannot be inserted "
        + "behind an existing row. Pick a date after the newest rate below."
      );
    case "merchant_not_found":
      return "This property no longer exists.";
    default:
      return `Could not set the rate (${key}).`;
  }
}
