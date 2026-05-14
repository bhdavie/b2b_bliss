"use client";

import { useState } from "react";
import {
  updatePlanRules,
  type AllowedFrequencies,
  type PlanFrequency,
  type PlanRules,
} from "@/lib/api";

type FormState = {
  minLeadTimeWeeks: string;
  maxLeadTimeWeeks: string;
  allowedFrequencies: AllowedFrequencies;
  minBookingDollars: string;
  maxBookingDollars: string;
  recommendedFrequency: "" | PlanFrequency;
};

export function PlanRulesCard({ initial }: { initial: PlanRules }) {
  const [form, setForm] = useState<FormState>(toForm(initial));
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      // If the recommended frequency is no longer permitted, clear it.
      if (key === "allowedFrequencies") {
        if (value === "monthly" && next.recommendedFrequency === "biweekly") {
          next.recommendedFrequency = "";
        } else if (value === "biweekly" && next.recommendedFrequency === "monthly") {
          next.recommendedFrequency = "";
        }
      }
      return next;
    });
    setSavedAt(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const minLead = parseInt(form.minLeadTimeWeeks, 10);
    if (!Number.isFinite(minLead) || minLead < 0) {
      setError("Minimum lead time must be 0 or more weeks.");
      return;
    }
    const maxLead = form.maxLeadTimeWeeks.trim() === ""
      ? null
      : parseInt(form.maxLeadTimeWeeks, 10);
    if (maxLead !== null && (!Number.isFinite(maxLead) || maxLead < 1)) {
      setError("Maximum lead time must be 1 or more weeks (or blank).");
      return;
    }
    if (maxLead !== null && maxLead < minLead) {
      setError("Maximum lead time must be at least the minimum.");
      return;
    }
    const minAmtCents = parseDollarsOrNull(form.minBookingDollars);
    const maxAmtCents = parseDollarsOrNull(form.maxBookingDollars);
    if (minAmtCents === undefined) {
      setError("Minimum booking amount must be a positive number.");
      return;
    }
    if (maxAmtCents === undefined) {
      setError("Maximum booking amount must be a positive number.");
      return;
    }
    if (minAmtCents !== null && maxAmtCents !== null && maxAmtCents < minAmtCents) {
      setError("Maximum amount must be at least the minimum.");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const payload: PlanRules = {
        minLeadTimeWeeks: minLead,
        maxLeadTimeWeeks: maxLead,
        allowedFrequencies: form.allowedFrequencies,
        minBookingAmountCents: minAmtCents,
        maxBookingAmountCents: maxAmtCents,
        recommendedFrequency: form.recommendedFrequency === ""
          ? null
          : form.recommendedFrequency,
      };
      const saved = await updatePlanRules(payload);
      setForm(toForm(saved));
      setSavedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save plan rules.");
    } finally {
      setSaving(false);
    }
  }

  const bothAllowed = form.allowedFrequencies === "both";

  return (
    <form onSubmit={handleSubmit} className="card p-6 space-y-6">
      <Row label="Lead time" hint="How far in advance bookings must be to qualify for a plan.">
        <div className="grid grid-cols-2 gap-3">
          <NumberInput
            label="Minimum (weeks)"
            value={form.minLeadTimeWeeks}
            onChange={(v) => update("minLeadTimeWeeks", v)}
            min={0}
            placeholder="6"
          />
          <NumberInput
            label="Maximum (weeks, optional)"
            value={form.maxLeadTimeWeeks}
            onChange={(v) => update("maxLeadTimeWeeks", v)}
            min={1}
            placeholder="No limit"
          />
        </div>
      </Row>

      <Row label="Allowed frequencies" hint="Which cadences your customers can choose from.">
        <div className="grid gap-2 sm:grid-cols-3">
          {(
            [
              { value: "both", label: "Both", body: "Customer picks bi-weekly or monthly." },
              { value: "monthly", label: "Monthly only", body: "Fewer, larger payments." },
              { value: "biweekly", label: "Bi-weekly only", body: "More frequent, smaller payments." },
            ] satisfies { value: AllowedFrequencies; label: string; body: string }[]
          ).map((opt) => (
            <FrequencyOption
              key={opt.value}
              value={opt.value}
              label={opt.label}
              body={opt.body}
              selected={form.allowedFrequencies === opt.value}
              onSelect={() => update("allowedFrequencies", opt.value)}
            />
          ))}
        </div>
      </Row>

      {bothAllowed ? (
        <Row label="Recommended frequency" hint='Which plan carries the "Recommended" badge when both are offered.'>
          <div className="grid grid-cols-3 gap-2 max-w-md">
            {(
              [
                { value: "", label: "Auto (monthly)" },
                { value: "monthly", label: "Monthly" },
                { value: "biweekly", label: "Bi-weekly" },
              ] satisfies { value: "" | PlanFrequency; label: string }[]
            ).map((opt) => (
              <PillToggle
                key={opt.value || "auto"}
                label={opt.label}
                selected={form.recommendedFrequency === opt.value}
                onSelect={() => update("recommendedFrequency", opt.value)}
              />
            ))}
          </div>
        </Row>
      ) : null}

      <Row label="Booking amount" hint="Cap or floor the prices you accept payment plans on.">
        <div className="grid grid-cols-2 gap-3">
          <DollarInput
            label="Minimum (optional)"
            value={form.minBookingDollars}
            onChange={(v) => update("minBookingDollars", v)}
            placeholder="No floor"
          />
          <DollarInput
            label="Maximum (optional)"
            value={form.maxBookingDollars}
            onChange={(v) => update("maxBookingDollars", v)}
            placeholder="No cap"
          />
        </div>
      </Row>

      {error ? (
        <div className="text-xs text-red-600" role="alert">
          {error}
        </div>
      ) : null}

      <div className="flex items-center justify-between border-t border-surface-border pt-4">
        <div className="text-xs text-ink-soft">
          {savedAt ? "Rules saved" : "Customers see these on their hosted page."}
        </div>
        <button
          type="submit"
          disabled={saving}
          className="btn-primary"
        >
          {saving ? "Saving" : "Save rules"}
        </button>
      </div>
    </form>
  );
}

function toForm(rules: PlanRules): FormState {
  return {
    minLeadTimeWeeks: String(rules.minLeadTimeWeeks),
    maxLeadTimeWeeks: rules.maxLeadTimeWeeks == null ? "" : String(rules.maxLeadTimeWeeks),
    allowedFrequencies: rules.allowedFrequencies,
    minBookingDollars: centsToDollars(rules.minBookingAmountCents),
    maxBookingDollars: centsToDollars(rules.maxBookingAmountCents),
    recommendedFrequency: rules.recommendedFrequency ?? "",
  };
}

function centsToDollars(cents: number | null): string {
  if (cents == null) return "";
  if (cents % 100 === 0) return String(cents / 100);
  return (cents / 100).toFixed(2);
}

// Returns null for blank input, the parsed cents for valid input, or
// undefined for invalid input (so the caller can surface a validation error).
function parseDollarsOrNull(input: string): number | null | undefined {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  if (!/^\d+(\.\d{0,2})?$/.test(trimmed)) return undefined;
  const [whole, fraction = ""] = trimmed.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isFinite(cents) || cents <= 0) return undefined;
  return cents;
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="grid gap-3 sm:grid-cols-[180px_1fr]">
      <div>
        <div className="text-sm font-medium text-ink">{label}</div>
        {hint ? (
          <div className="mt-1 text-xs text-ink-soft leading-snug">{hint}</div>
        ) : null}
      </div>
      <div>{children}</div>
    </section>
  );
}

function NumberInput({
  label,
  value,
  onChange,
  min,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  min: number;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs text-ink-muted">{label}</span>
      <input
        type="number"
        inputMode="numeric"
        value={value}
        min={min}
        onChange={(e) => onChange(e.target.value)}
        className="input mt-1.5"
        placeholder={placeholder}
      />
    </label>
  );
}

function DollarInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs text-ink-muted">{label}</span>
      <div className="relative mt-1.5">
        <span
          className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-ink-soft"
          aria-hidden="true"
        >
          $
        </span>
        <input
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="input pl-7"
          placeholder={placeholder}
        />
      </div>
    </label>
  );
}

function FrequencyOption({
  value,
  label,
  body,
  selected,
  onSelect,
}: {
  value: AllowedFrequencies;
  label: string;
  body: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`text-left rounded-md p-3 transition-colors ${
        selected
          ? "border-2 border-lavender-500 bg-lavender-50"
          : "border border-surface-border bg-white hover:border-lavender-300"
      }`}
    >
      <div className={`text-sm font-medium ${selected ? "text-lavender-700" : "text-ink"}`}>
        {label}
      </div>
      <div className="mt-0.5 text-xs text-ink-soft leading-snug">{body}</div>
      <input
        type="radio"
        name="allowed_frequencies"
        value={value}
        checked={selected}
        onChange={onSelect}
        className="sr-only"
        tabIndex={-1}
      />
    </button>
  );
}

function PillToggle({
  label,
  selected,
  onSelect,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`rounded-md py-2 text-sm transition-colors ${
        selected
          ? "bg-lavender-500 text-white"
          : "border border-surface-border bg-white text-ink hover:border-lavender-300"
      }`}
    >
      {label}
    </button>
  );
}
