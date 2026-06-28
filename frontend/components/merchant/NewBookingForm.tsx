"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createBooking,
  DEFAULT_PLAN_RULES,
  type CreateBookingPayload,
  type PlanRules,
} from "@/lib/api";
import {
  formatCents,
  formatScheduleDate,
  previewEligibility,
} from "@/lib/eligibility";

type FormState = {
  serviceName: string;
  totalDollars: string;
  appointmentDate: string;
  customerNameHint: string;
  customerEmailHint: string;
  cancellationPolicy: string;
};

const EMPTY: FormState = {
  serviceName: "",
  totalDollars: "",
  appointmentDate: "",
  customerNameHint: "",
  customerEmailHint: "",
  cancellationPolicy: "",
};

export function NewBookingForm({
  planRules = DEFAULT_PLAN_RULES,
}: {
  planRules?: PlanRules;
}) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const totalCents = parseDollarsToCents(form.totalDollars);
  const appointmentDate = parseLocalDate(form.appointmentDate);
  const preview = useMemo(
    () => previewEligibility(today(), appointmentDate, totalCents ?? 0, planRules),
    [appointmentDate, totalCents, planRules],
  );

  const valid =
    form.serviceName.trim() !== "" &&
    totalCents !== null &&
    totalCents > 0 &&
    appointmentDate !== null &&
    appointmentDate > today();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || totalCents === null) return;
    setError(null);
    setSubmitting(true);
    const payload: CreateBookingPayload = {
      serviceName: form.serviceName.trim(),
      totalAmountCents: totalCents,
      appointmentDate: form.appointmentDate,
      customerNameHint: form.customerNameHint.trim() || undefined,
      customerEmailHint: form.customerEmailHint.trim() || undefined,
      cancellationPolicy: form.cancellationPolicy.trim() || undefined,
    };
    try {
      const booking = await createBooking(payload);
      router.push(`/bookings/${booking.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create booking");
      setSubmitting(false);
    }
  }

  return (
    <form className="mt-8 grid gap-6 md:grid-cols-[1fr_320px]" onSubmit={handleSubmit}>
      <section className="card p-6 space-y-4">
        <label className="block">
          <span className="label">Service name</span>
          <input
            className="input mt-1.5"
            value={form.serviceName}
            onChange={(e) => update("serviceName", e.target.value)}
            placeholder="Sarah & James wedding"
            maxLength={255}
            required
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="label">Total price (USD)</span>
            <input
              className="input mt-1.5"
              value={form.totalDollars}
              onChange={(e) => update("totalDollars", e.target.value)}
              placeholder="4000.00"
              inputMode="decimal"
              required
            />
          </label>
          <label className="block">
            <span className="label">Appointment date</span>
            <input
              className="input mt-1.5"
              type="date"
              value={form.appointmentDate}
              onChange={(e) => update("appointmentDate", e.target.value)}
              min={tomorrowIso()}
              required
            />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="label">Customer name (optional)</span>
            <input
              className="input mt-1.5"
              value={form.customerNameHint}
              onChange={(e) => update("customerNameHint", e.target.value)}
              placeholder="Sarah Lee"
              maxLength={255}
            />
          </label>
          <label className="block">
            <span className="label">Customer email (optional)</span>
            <input
              className="input mt-1.5"
              value={form.customerEmailHint}
              onChange={(e) => update("customerEmailHint", e.target.value)}
              type="email"
              placeholder="sarah@example.com"
              maxLength={255}
            />
          </label>
        </div>

        <label className="block">
          <span className="label">Cancellation policy (optional)</span>
          <textarea
            className="input mt-1.5 min-h-[80px]"
            value={form.cancellationPolicy}
            onChange={(e) => update("cancellationPolicy", e.target.value)}
            placeholder="Full refund up to 60 days out, 50% up to 30 days, no refund inside 30 days."
          />
        </label>

        {error ? (
          <div className="text-xs text-red-600" role="alert">
            {error}
          </div>
        ) : null}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            className="btn-ghost"
            onClick={() => router.push("/bookings")}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="btn-primary"
            disabled={!valid || submitting}
          >
            {submitting ? "Creating" : "Create booking"}
          </button>
        </div>
      </section>

      <aside className="card-subtle space-y-3">
        <div className="text-xs text-ink-muted font-medium">
          Plan preview
        </div>
        <EligibilityPreview
          totalCents={totalCents}
          appointmentDate={appointmentDate}
          preview={preview}
        />
      </aside>
    </form>
  );
}

function EligibilityPreview({
  totalCents,
  appointmentDate,
  preview,
}: {
  totalCents: number | null;
  appointmentDate: Date | null;
  preview: ReturnType<typeof previewEligibility>;
}) {
  if (!appointmentDate || totalCents === null) {
    return (
      <p className="text-xs text-ink-muted">
        Pick a date and total to see the eligible plans.
      </p>
    );
  }

  if (!preview.eligible) {
    return <IneligibleHint preview={preview} />;
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-muted">
        {preview.daysToAppointment} days out.{" "}
        {preview.options.length === 1
          ? "One plan option offered."
          : "Two plan options offered."}
      </p>
      {preview.depositAmountCents > 0 ? (
        <div className="rounded-md border border-brand-purple/20 bg-brand-purple text-white px-3 py-2 text-xs">
          <div className="text-[10px] text-white/80">
            Deposit today
          </div>
          <div className="mt-0.5 text-[14px] font-medium tabular-nums">
            {formatCents(preview.depositAmountCents)}
          </div>
        </div>
      ) : null}
      {preview.options.map((opt) => (
        <div
          key={opt.frequency}
          className={`relative rounded-md border p-3 text-xs ${
            opt.recommended
              ? "border-brand-purple bg-brand-lavender/20"
              : "border-brand-neutral bg-white"
          }`}
        >
          {opt.recommended ? (
            <span className="absolute -top-2 left-2 rounded-full bg-brand-lavender px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-white">
              Recommended
            </span>
          ) : null}
          <div className="flex items-baseline justify-between">
            <div
              className={`font-medium capitalize ${
                opt.recommended ? "text-brand-purple" : ""
              }`}
            >
              {opt.frequency}
            </div>
            <div className="text-ink-muted">{opt.numPayments} payments</div>
          </div>
          <div className="mt-1 text-ink-muted">
            {opt.numPayments - 1} of {formatCents(opt.perPaymentAmountCents)}
            {opt.finalPaymentAmountCents !== opt.perPaymentAmountCents
              ? ` then ${formatCents(opt.finalPaymentAmountCents)}`
              : ""}
          </div>
          <div className="mt-2 text-[11px] text-ink-muted">
            First: {formatScheduleDate(opt.dueDates[0] ?? "")} · Last:{" "}
            {formatScheduleDate(opt.dueDates[opt.dueDates.length - 1] ?? "")}
          </div>
        </div>
      ))}
      <p className="text-[11px] text-ink-muted">
        Final payment lands at least 3 days before the appointment so any retry
        clears before your date.
      </p>
    </div>
  );
}

function IneligibleHint({
  preview,
}: {
  preview: ReturnType<typeof previewEligibility>;
}) {
  switch (preview.reason) {
    case "too_close":
      return (
        <p className="text-xs text-ink-muted">
          This date is in <strong>{preview.daysToAppointment} days</strong>,
          inside your minimum lead time. Customer will be prompted to pay
          directly.
        </p>
      );
    case "too_far":
      return (
        <p className="text-xs text-ink-muted">
          This date is past your maximum lead time. Customer will be prompted
          to pay directly.
        </p>
      );
    case "amount_too_low":
      return (
        <p className="text-xs text-ink-muted">
          Total is below your plan minimum. Customer will be prompted to pay
          in full.
        </p>
      );
    case "amount_too_high":
      return (
        <p className="text-xs text-ink-muted">
          Total is above your plan maximum. Customer will be prompted to pay
          in full.
        </p>
      );
    case "deposit_too_high":
      return (
        <p className="text-xs text-ink-muted">
          Your fixed deposit exceeds this booking total. Lower the deposit or
          set a max cap in plan rules.
        </p>
      );
    case "no_plan_fits":
      return (
        <p className="text-xs text-ink-muted">
          No allowed cadence fits before this date. Try widening the lead time
          or enabling another frequency in plan rules.
        </p>
      );
    case "invalid_input":
    case "ok":
    default:
      return (
        <p className="text-xs text-ink-muted">
          Pick a date in the future to preview the plan.
        </p>
      );
  }
}

function parseDollarsToCents(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  if (!/^\d+(\.\d{0,2})?$/.test(trimmed)) return null;
  const [whole, fraction = ""] = trimmed.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isFinite(cents) || cents <= 0) return null;
  return cents;
}

function parseLocalDate(iso: string): Date | null {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return null;
  const dt = new Date(y, m - 1, d);
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
}

function today(): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function tomorrowIso(): string {
  const t = today();
  t.setDate(t.getDate() + 1);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(
    t.getDate(),
  ).padStart(2, "0")}`;
}
