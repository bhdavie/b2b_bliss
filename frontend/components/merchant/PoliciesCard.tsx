"use client";

import { useState } from "react";
import {
  updatePlanRules,
  type AfterRetriesAction,
  type FeeType,
  type LateFeeScope,
  type PaymentDuePolicy,
  type PlanRules,
  type RefundPolicy,
} from "@/lib/api";

type FormState = {
  refundPolicy: RefundPolicy;
  refundSlidingThresholdPercent: string;
  cancellationFeeEnabled: boolean;
  cancellationFeeType: FeeType;
  cancellationFeePercent: string;
  cancellationFeeDollars: string;
  cancellationFeeThresholdPercent: string;
  paymentDuePolicy: PaymentDuePolicy;
  paymentDueCustomMonths: string;
  retryAttempts: string;
  retrySpacingDays: "1" | "3" | "7";
  lateFeeEnabled: boolean;
  lateFeeType: FeeType;
  lateFeePercent: string;
  lateFeeDollars: string;
  lateFeeScope: LateFeeScope;
  afterRetriesAction: AfterRetriesAction;
};

const REFUND_OPTIONS: { value: RefundPolicy; label: string; body: string }[] = [
  { value: "full", label: "Full refund", body: "Customer gets every cleared installment back." },
  { value: "none", label: "No refund", body: "Paid installments stay with you on cancellation." },
  {
    value: "first_installment_only",
    label: "First installment only",
    body: "Only the first payment is refundable. Later installments are kept.",
  },
  {
    value: "sliding_scale",
    label: "Sliding scale",
    body: "Full refund early in the plan, no refund after the threshold.",
  },
  {
    value: "credit_only",
    label: "Credit for future",
    body: "No cash back. Amount becomes credit toward another booking with you.",
  },
];

const DUE_POLICY_OPTIONS: { value: PaymentDuePolicy; label: string; body: string }[] = [
  { value: "at_appointment", label: "At check-in", body: "All payments due by the appointment date." },
  { value: "one_week_before", label: "1 week before", body: "All payments cleared 7 days before." },
  { value: "one_month_before", label: "1 month before", body: "All payments cleared 30 days before." },
  { value: "custom_months", label: "Custom", body: "Pick N months before the appointment." },
];

const AFTER_RETRIES_OPTIONS: { value: AfterRetriesAction; label: string; body: string }[] = [
  {
    value: "balance_due_at_checkin",
    label: "Balance due at check-in",
    body: "Booking stays active. Customer settles the remaining balance directly when they arrive.",
  },
  {
    value: "treat_as_cancellation",
    label: "Treat as a cancellation",
    body: "Booking is canceled. Your Refund policy above governs the outcome.",
  },
];

export function PoliciesCard({ initial }: { initial: PlanRules }) {
  const [form, setForm] = useState<FormState>(toForm(initial));
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSavedAt(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Validate sliding scale threshold
    let slidingThreshold: number | null = null;
    if (form.refundPolicy === "sliding_scale") {
      const t = parseInt(form.refundSlidingThresholdPercent, 10);
      if (!Number.isFinite(t) || t < 1 || t > 99) {
        setError("Sliding scale threshold must be 1-99%.");
        return;
      }
      slidingThreshold = t;
    }

    // Cancellation fee
    let cancellationFeeType: FeeType | null = null;
    let cancellationFeeValue: number | null = null;
    let cancellationFeeThreshold: number | null = null;
    if (form.cancellationFeeEnabled) {
      cancellationFeeType = form.cancellationFeeType;
      if (cancellationFeeType === "percentage") {
        const v = parseInt(form.cancellationFeePercent, 10);
        if (!Number.isFinite(v) || v < 1 || v > 100) {
          setError("Cancellation fee percent must be 1-100.");
          return;
        }
        cancellationFeeValue = v;
      } else {
        const cents = parseDollarsOrNull(form.cancellationFeeDollars);
        if (cents === undefined || cents === null) {
          setError("Cancellation fee amount must be a positive dollar value.");
          return;
        }
        cancellationFeeValue = cents;
      }
      if (form.cancellationFeeThresholdPercent.trim() !== "") {
        const t = parseInt(form.cancellationFeeThresholdPercent, 10);
        if (!Number.isFinite(t) || t < 0 || t > 100) {
          setError("Cancellation fee threshold must be 0-100%.");
          return;
        }
        cancellationFeeThreshold = t;
      }
    }

    // Due policy
    let customMonths: number | null = null;
    if (form.paymentDuePolicy === "custom_months") {
      const m = parseInt(form.paymentDueCustomMonths, 10);
      if (!Number.isFinite(m) || m < 1 || m > 24) {
        setError("Custom months must be 1-24.");
        return;
      }
      customMonths = m;
    }

    // Retry
    const retryAttempts = parseInt(form.retryAttempts, 10);
    if (!Number.isFinite(retryAttempts) || retryAttempts < 1 || retryAttempts > 5) {
      setError("Retry attempts must be 1-5.");
      return;
    }

    // Late fee
    let lateFeeType: FeeType | null = null;
    let lateFeeValue: number | null = null;
    let lateFeeScope: LateFeeScope | null = null;
    if (form.lateFeeEnabled) {
      lateFeeType = form.lateFeeType;
      if (lateFeeType === "percentage") {
        const v = parseInt(form.lateFeePercent, 10);
        if (!Number.isFinite(v) || v < 1 || v > 100) {
          setError("Late fee percent must be 1-100.");
          return;
        }
        lateFeeValue = v;
      } else {
        const cents = parseDollarsOrNull(form.lateFeeDollars);
        if (cents === undefined || cents === null) {
          setError("Late fee amount must be a positive dollar value.");
          return;
        }
        lateFeeValue = cents;
      }
      lateFeeScope = form.lateFeeScope;
    }

    setSaving(true);
    try {
      // We need to PUT the FULL PlanRules — refresh from initial for unchanged fields.
      const payload: PlanRules = {
        ...initial,
        refundPolicy: form.refundPolicy,
        refundSlidingThresholdPercent: slidingThreshold,
        cancellationFeeEnabled: form.cancellationFeeEnabled,
        cancellationFeeType,
        cancellationFeeValue,
        cancellationFeeThresholdPercent: cancellationFeeThreshold,
        paymentDuePolicy: form.paymentDuePolicy,
        paymentDueCustomMonths: customMonths,
        retryAttempts,
        retrySpacingDays: parseInt(form.retrySpacingDays, 10),
        lateFeeEnabled: form.lateFeeEnabled,
        lateFeeType,
        lateFeeValue,
        lateFeeScope,
        afterRetriesAction: form.afterRetriesAction,
      };
      const saved = await updatePlanRules(payload);
      setForm(toForm(saved));
      setSavedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save policies.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      <div className="card p-6 space-y-6">
        <SectionTitle>Cancellation policies</SectionTitle>

        <Row label="Refund policy" hint="What customers get back if they cancel a plan in progress.">
          <div className="grid gap-2 sm:grid-cols-2">
            {REFUND_OPTIONS.map((opt) => (
              <OptionCard
                key={opt.value}
                label={opt.label}
                body={opt.body}
                selected={form.refundPolicy === opt.value}
                onSelect={() => update("refundPolicy", opt.value)}
              />
            ))}
          </div>
          {form.refundPolicy === "sliding_scale" ? (
            <div className="mt-3 max-w-xs">
              <PercentInput
                label="Refund cutoff (% of plan progress)"
                value={form.refundSlidingThresholdPercent}
                onChange={(v) => update("refundSlidingThresholdPercent", v)}
                placeholder="50"
              />
            </div>
          ) : null}
        </Row>

        <Row
          label="Cancellation fee"
          hint="An optional fee charged on cancellation, separate from refund logic."
        >
          <div className="space-y-3">
            <Toggle
              label="Charge a cancellation fee"
              on={form.cancellationFeeEnabled}
              onChange={(v) => update("cancellationFeeEnabled", v)}
            />
            {form.cancellationFeeEnabled ? (
              <div className="rounded-md bg-lavender-50/40 p-3 space-y-3">
                <div className="grid grid-cols-2 gap-2 max-w-md">
                  <PillToggle
                    label="Percentage"
                    selected={form.cancellationFeeType === "percentage"}
                    onSelect={() => update("cancellationFeeType", "percentage")}
                  />
                  <PillToggle
                    label="Fixed amount"
                    selected={form.cancellationFeeType === "fixed"}
                    onSelect={() => update("cancellationFeeType", "fixed")}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {form.cancellationFeeType === "percentage" ? (
                    <PercentInput
                      label="Cancellation fee (%)"
                      value={form.cancellationFeePercent}
                      onChange={(v) => update("cancellationFeePercent", v)}
                      placeholder="10"
                    />
                  ) : (
                    <DollarInput
                      label="Cancellation fee"
                      value={form.cancellationFeeDollars}
                      onChange={(v) => update("cancellationFeeDollars", v)}
                      placeholder="50"
                    />
                  )}
                  <NumberInput
                    label="Only after (% through plan, optional)"
                    value={form.cancellationFeeThresholdPercent}
                    onChange={(v) => update("cancellationFeeThresholdPercent", v)}
                    min={0}
                    placeholder="No threshold"
                  />
                </div>
              </div>
            ) : null}
          </div>
        </Row>
      </div>

      <div className="card p-6 space-y-6">
        <SectionTitle>Payment deadline</SectionTitle>

        <Row
          label="All installments due by"
          hint="Cuts off the plan window. Customers can't pick a plan whose final installment falls after this date."
        >
          <div className="grid gap-2 sm:grid-cols-2">
            {DUE_POLICY_OPTIONS.map((opt) => (
              <OptionCard
                key={opt.value}
                label={opt.label}
                body={opt.body}
                selected={form.paymentDuePolicy === opt.value}
                onSelect={() => update("paymentDuePolicy", opt.value)}
              />
            ))}
          </div>
          {form.paymentDuePolicy === "custom_months" ? (
            <div className="mt-3 max-w-xs">
              <NumberInput
                label="Months before appointment"
                value={form.paymentDueCustomMonths}
                onChange={(v) => update("paymentDueCustomMonths", v)}
                min={1}
                placeholder="2"
              />
            </div>
          ) : null}
        </Row>
      </div>

      <div className="card p-6 space-y-6">
        <SectionTitle>Failed payment handling</SectionTitle>

        <Row label="Retry policy" hint="How aggressively to retry a failed installment.">
          <div className="grid grid-cols-2 gap-3 max-w-md">
            <NumberInput
              label="Retry attempts"
              value={form.retryAttempts}
              onChange={(v) => update("retryAttempts", v)}
              min={1}
              placeholder="3"
            />
            <label className="block">
              <span className="text-xs text-ink-muted">Spacing (days)</span>
              <select
                value={form.retrySpacingDays}
                onChange={(e) => update("retrySpacingDays", e.target.value as "1" | "3" | "7")}
                className="input mt-1.5"
              >
                <option value="1">1 day</option>
                <option value="3">3 days</option>
                <option value="7">7 days</option>
              </select>
            </label>
          </div>
        </Row>

        <Row label="Late fee" hint="Optional fee added to the customer's balance when an installment fails.">
          <div className="space-y-3">
            <Toggle
              label="Charge a late fee on failed payment"
              on={form.lateFeeEnabled}
              onChange={(v) => update("lateFeeEnabled", v)}
            />
            {form.lateFeeEnabled ? (
              <div className="rounded-md bg-lavender-50/40 p-3 space-y-3">
                <div className="grid grid-cols-2 gap-2 max-w-md">
                  <PillToggle
                    label="Percentage"
                    selected={form.lateFeeType === "percentage"}
                    onSelect={() => update("lateFeeType", "percentage")}
                  />
                  <PillToggle
                    label="Fixed amount"
                    selected={form.lateFeeType === "fixed"}
                    onSelect={() => update("lateFeeType", "fixed")}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {form.lateFeeType === "percentage" ? (
                    <PercentInput
                      label="Late fee (% of installment)"
                      value={form.lateFeePercent}
                      onChange={(v) => update("lateFeePercent", v)}
                      placeholder="5"
                    />
                  ) : (
                    <DollarInput
                      label="Late fee"
                      value={form.lateFeeDollars}
                      onChange={(v) => update("lateFeeDollars", v)}
                      placeholder="25"
                    />
                  )}
                  <label className="block">
                    <span className="text-xs text-ink-muted">Apply</span>
                    <select
                      value={form.lateFeeScope}
                      onChange={(e) => update("lateFeeScope", e.target.value as LateFeeScope)}
                      className="input mt-1.5"
                    >
                      <option value="per_failure">Per failure</option>
                      <option value="once_per_plan">Once per plan</option>
                    </select>
                  </label>
                </div>
              </div>
            ) : null}
          </div>
        </Row>

        <Row
          label="When retries are exhausted"
          hint="What happens to the booking and the customer's paid installments once you've run out of retry attempts."
        >
          <div className="grid gap-2 sm:grid-cols-2">
            {AFTER_RETRIES_OPTIONS.map((opt) => (
              <OptionCard
                key={opt.value}
                label={opt.label}
                body={opt.body}
                selected={form.afterRetriesAction === opt.value}
                onSelect={() => update("afterRetriesAction", opt.value)}
              />
            ))}
          </div>
        </Row>
      </div>

      {error ? (
        <div className="text-xs text-red-600" role="alert">
          {error}
        </div>
      ) : null}

      <div className="flex items-center justify-between">
        <div className="text-xs text-ink-soft">
          {savedAt ? "Policies saved" : "These show on the customer's hosted page as trust signals."}
        </div>
        <button type="submit" disabled={saving} className="btn-primary">
          {saving ? "Saving" : "Save policies"}
        </button>
      </div>
    </form>
  );
}

function toForm(rules: PlanRules): FormState {
  return {
    refundPolicy: rules.refundPolicy,
    refundSlidingThresholdPercent: rules.refundSlidingThresholdPercent?.toString() ?? "",
    cancellationFeeEnabled: rules.cancellationFeeEnabled,
    cancellationFeeType: rules.cancellationFeeType ?? "fixed",
    cancellationFeePercent:
      rules.cancellationFeeType === "percentage" && rules.cancellationFeeValue != null
        ? String(rules.cancellationFeeValue)
        : "",
    cancellationFeeDollars:
      rules.cancellationFeeType === "fixed" && rules.cancellationFeeValue != null
        ? centsToDollars(rules.cancellationFeeValue)
        : "",
    cancellationFeeThresholdPercent: rules.cancellationFeeThresholdPercent?.toString() ?? "",
    paymentDuePolicy: rules.paymentDuePolicy,
    paymentDueCustomMonths: rules.paymentDueCustomMonths?.toString() ?? "",
    retryAttempts: rules.retryAttempts.toString(),
    retrySpacingDays: (rules.retrySpacingDays.toString() as "1" | "3" | "7"),
    lateFeeEnabled: rules.lateFeeEnabled,
    lateFeeType: rules.lateFeeType ?? "fixed",
    lateFeePercent:
      rules.lateFeeType === "percentage" && rules.lateFeeValue != null
        ? String(rules.lateFeeValue)
        : "",
    lateFeeDollars:
      rules.lateFeeType === "fixed" && rules.lateFeeValue != null
        ? centsToDollars(rules.lateFeeValue)
        : "",
    lateFeeScope: rules.lateFeeScope ?? "per_failure",
    afterRetriesAction: rules.afterRetriesAction,
  };
}

function centsToDollars(cents: number): string {
  if (cents % 100 === 0) return String(cents / 100);
  return (cents / 100).toFixed(2);
}

function parseDollarsOrNull(input: string): number | null | undefined {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  if (!/^\d+(\.\d{0,2})?$/.test(trimmed)) return undefined;
  const [whole, fraction = ""] = trimmed.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isFinite(cents) || cents <= 0) return undefined;
  return cents;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-sm font-medium text-ink border-b border-surface-border pb-2">
      {children}
    </h3>
  );
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
    <section className="grid gap-3 sm:grid-cols-[200px_1fr]">
      <div>
        <div className="text-sm font-medium text-ink">{label}</div>
        {hint ? <div className="mt-1 text-xs text-ink-soft leading-snug">{hint}</div> : null}
      </div>
      <div>{children}</div>
    </section>
  );
}

function OptionCard({
  label,
  body,
  selected,
  onSelect,
}: {
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

function Toggle({
  label,
  on,
  onChange,
}: {
  label: string;
  on: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-3 cursor-pointer">
      <span
        role="switch"
        aria-checked={on}
        tabIndex={0}
        onClick={() => onChange(!on)}
        onKeyDown={(e) => {
          if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            onChange(!on);
          }
        }}
        className={`relative inline-flex h-5 w-9 flex-none rounded-full transition-colors ${
          on ? "bg-lavender-500" : "bg-surface-border"
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
            on ? "translate-x-4" : ""
          }`}
        />
      </span>
      <span className="text-sm text-ink">{label}</span>
    </label>
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

function PercentInput({
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
        <input
          type="number"
          inputMode="numeric"
          min={0}
          max={100}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="input pr-8"
          placeholder={placeholder}
        />
        <span
          className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-ink-soft"
          aria-hidden="true"
        >
          %
        </span>
      </div>
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
