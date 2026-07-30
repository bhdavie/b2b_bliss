"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { modifyBooking, type ModificationResult } from "@/lib/api";
import { formatDollars, formatScheduleDateShort } from "@/lib/publicApi";
import { Button } from "@/components/ui/Button";

// Merchant-only booking modification: change dates and/or total, see a preview
// of the rebuilt schedule (paid/processing rows preserved), then confirm. The
// preview is a dry-run against the same recalc the apply uses.

export function ModifyBookingAction({
  bookingId,
  currentAppointmentDate,
  currentCheckoutDate,
  currentTotalCents,
}: {
  bookingId: string;
  currentAppointmentDate: string;
  currentCheckoutDate: string | null;
  currentTotalCents: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [appt, setAppt] = useState(currentAppointmentDate);
  const [checkout, setCheckout] = useState(currentCheckoutDate ?? "");
  const [totalDollars, setTotalDollars] = useState((currentTotalCents / 100).toFixed(2));
  const [preview, setPreview] = useState<ModificationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "preview" | "apply">(null);

  function buildPayload(isPreview: boolean) {
    const p: {
      appointmentDate?: string;
      checkoutDate?: string;
      newTotalAmountCents?: number;
      preview: boolean;
    } = { preview: isPreview };
    if (appt && appt !== currentAppointmentDate) p.appointmentDate = appt;
    if (checkout && checkout !== (currentCheckoutDate ?? "")) p.checkoutDate = checkout;
    const cents = Math.round(parseFloat(totalDollars) * 100);
    if (Number.isFinite(cents) && cents !== currentTotalCents) p.newTotalAmountCents = cents;
    return p;
  }

  function hasChange(p: ReturnType<typeof buildPayload>) {
    return (
      p.appointmentDate !== undefined ||
      p.checkoutDate !== undefined ||
      p.newTotalAmountCents !== undefined
    );
  }

  async function runPreview() {
    setError(null);
    const payload = buildPayload(true);
    if (!hasChange(payload)) {
      setError("Change a date or the total first.");
      return;
    }
    setBusy("preview");
    const res = await modifyBooking(bookingId, payload);
    setBusy(null);
    if (res.ok) {
      setPreview(res.data);
    } else {
      setPreview(null);
      setError(res.message);
    }
  }

  async function apply() {
    setError(null);
    const payload = buildPayload(false);
    if (!hasChange(payload)) {
      setError("Change a date or the total first.");
      return;
    }
    setBusy("apply");
    const res = await modifyBooking(bookingId, payload);
    setBusy(null);
    if (res.ok) {
      router.refresh();
      setOpen(false);
      setPreview(null);
    } else {
      setError(res.message);
    }
  }

  if (!open) {
    return (
      <Button
        type="button"
        onClick={() => setOpen(true)}
        variant="ghost"
      >
        Modify booking
      </Button>
    );
  }

  return (
    <section className="border border-brand-neutral bg-white p-5">
      <h3 className="text-sm font-semibold text-brand-navy">Modify booking</h3>
      <p className="mt-1 text-xs text-brand-navy/60">
        Change the dates or total. Paid and in-progress installments are kept; only the
        remaining schedule is rebuilt. Preview before you confirm.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="text-[11px] font-medium uppercase tracking-wide text-brand-navy/55">
            Check-in
          </span>
          <input
            type="date"
            value={appt}
            onChange={(e) => setAppt(e.target.value)}
            className="mt-1 w-full border border-brand-neutral px-2 py-1.5 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-[11px] font-medium uppercase tracking-wide text-brand-navy/55">
            Check-out
          </span>
          <input
            type="date"
            value={checkout}
            onChange={(e) => setCheckout(e.target.value)}
            className="mt-1 w-full border border-brand-neutral px-2 py-1.5 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-[11px] font-medium uppercase tracking-wide text-brand-navy/55">
            Total ($)
          </span>
          <input
            type="number"
            step="0.01"
            min="0"
            value={totalDollars}
            onChange={(e) => setTotalDollars(e.target.value)}
            className="mt-1 w-full border border-brand-neutral px-2 py-1.5 text-sm tabular-nums"
          />
        </label>
      </div>

      {error ? (
        <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      {preview ? (
        <div className="mt-4 border border-brand-lavender/40 bg-brand-lavender/5 p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-brand-purple">
            {preview.outcome === "REFUND_DUE" ? "Preview · refund due" : "Preview · rebuilt schedule"}
          </div>
          <p className="mt-1 text-sm text-brand-navy">{preview.message}</p>
          <div className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
            <Stat label="Collected" value={formatDollars(preview.collectedCents)} />
            <Stat label="Remaining" value={formatDollars(preview.remainingToCollectCents)} />
            {preview.overpaidCents > 0 ? (
              <Stat label="Refund due" value={formatDollars(preview.overpaidCents)} />
            ) : null}
            <Stat label="Installments" value={String(preview.numPayments)} />
          </div>
          <ol className="mt-3 divide-y divide-brand-neutral border-t border-brand-neutral">
            {preview.schedule.map((r) => (
              <li key={r.sequence} className="flex items-center justify-between py-1.5 text-xs">
                <span className="text-brand-navy/70">
                  #{r.sequence} · {formatScheduleDateShort(r.dueDate)} ·{" "}
                  <span className="uppercase">{r.status}</span>
                </span>
                <span className="tabular-nums text-brand-navy">{formatDollars(r.amountCents)}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      <div className="mt-4 flex items-center gap-3">
        <Button
          type="button"
          onClick={runPreview}
          disabled={busy !== null}
          variant="ghost"
          className="disabled:opacity-60"
        >
          {busy === "preview" ? "Previewing" : "Preview"}
        </Button>
        <Button
          type="button"
          onClick={apply}
          disabled={busy !== null || preview === null}
          variant="merchant"
          className="disabled:opacity-50"
          title={preview === null ? "Preview first" : undefined}
        >
          {busy === "apply" ? "Applying" : "Confirm changes"}
        </Button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setPreview(null);
            setError(null);
          }}
          disabled={busy !== null}
          className="text-xs font-medium text-brand-navy/60 hover:text-brand-purple disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-brand-neutral bg-white px-2.5 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-brand-navy/55">{label}</div>
      <div className="mt-0.5 text-sm font-semibold tabular-nums text-ink">{value}</div>
    </div>
  );
}
