"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { updateMerchant, type UpdateMerchantPayload } from "@/lib/api";

type FormState = {
  businessName: string;
  businessType: string;
  phone: string;
  addressLine1: string;
  addressLine2: string;
  addressCity: string;
  addressState: string;
  addressZip: string;
};

const BUSINESS_TYPES = [
  { value: "photography", label: "Wedding or portrait photographer" },
  { value: "hotel", label: "Boutique hotel or resort" },
  { value: "retreat", label: "Retreat or workshop operator" },
  { value: "salon", label: "Salon or barber" },
  { value: "medspa", label: "Med spa or wellness clinic" },
  { value: "other", label: "Something else" },
];

const STEPS = [
  { id: "business", title: "Business" },
  { id: "contact", title: "Contact" },
  { id: "address", title: "Address" },
] as const;

export function OnboardingWizard({ initial }: { initial: FormState }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormState>(initial);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function canAdvance(): boolean {
    if (step === 0) return form.businessName.trim() !== "" && form.businessType !== "";
    if (step === 1) return true; // phone optional
    if (step === 2) {
      return (
        form.addressLine1.trim() !== "" &&
        form.addressCity.trim() !== "" &&
        form.addressState.trim() !== "" &&
        form.addressZip.trim() !== ""
      );
    }
    return false;
  }

  async function handleSubmit() {
    setError(null);
    setSubmitting(true);
    const payload: UpdateMerchantPayload = {
      businessName: form.businessName.trim(),
      businessType: form.businessType,
      phone: form.phone.trim() || undefined,
      addressLine1: form.addressLine1.trim() || undefined,
      addressLine2: form.addressLine2.trim() || undefined,
      addressCity: form.addressCity.trim() || undefined,
      addressState: form.addressState.trim() || undefined,
      addressZip: form.addressZip.trim() || undefined,
    };
    try {
      await updateMerchant(payload);
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-10 card p-6">
      <Stepper current={step} />

      {step === 0 && (
        <section className="mt-6 space-y-4">
          <label className="block">
            <span className="label">Business name</span>
            <input
              className="input mt-1.5"
              value={form.businessName}
              onChange={(e) => update("businessName", e.target.value)}
              placeholder="Sarah Lee Photography"
            />
          </label>
          <label className="block">
            <span className="label">Business type</span>
            <select
              className="input mt-1.5 bg-white"
              value={form.businessType}
              onChange={(e) => update("businessType", e.target.value)}
            >
              <option value="">Pick one</option>
              {BUSINESS_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
        </section>
      )}

      {step === 1 && (
        <section className="mt-6 space-y-4">
          <label className="block">
            <span className="label">Phone (optional)</span>
            <input
              className="input mt-1.5"
              value={form.phone}
              onChange={(e) => update("phone", e.target.value)}
              placeholder="(555) 123-4567"
              type="tel"
            />
          </label>
          <p className="text-xs text-ink-muted">
            We will not text customers from your number. This is for your account
            only.
          </p>
        </section>
      )}

      {step === 2 && (
        <section className="mt-6 space-y-4">
          <label className="block">
            <span className="label">Street address</span>
            <input
              className="input mt-1.5"
              value={form.addressLine1}
              onChange={(e) => update("addressLine1", e.target.value)}
              autoComplete="address-line1"
            />
          </label>
          <label className="block">
            <span className="label">Suite or unit (optional)</span>
            <input
              className="input mt-1.5"
              value={form.addressLine2}
              onChange={(e) => update("addressLine2", e.target.value)}
              autoComplete="address-line2"
            />
          </label>
          <div className="grid grid-cols-3 gap-3">
            <label className="block col-span-1">
              <span className="label">City</span>
              <input
                className="input mt-1.5"
                value={form.addressCity}
                onChange={(e) => update("addressCity", e.target.value)}
                autoComplete="address-level2"
              />
            </label>
            <label className="block col-span-1">
              <span className="label">State</span>
              <input
                className="input mt-1.5"
                value={form.addressState}
                onChange={(e) => update("addressState", e.target.value)}
                autoComplete="address-level1"
                placeholder="CA"
                maxLength={2}
              />
            </label>
            <label className="block col-span-1">
              <span className="label">Zip</span>
              <input
                className="input mt-1.5"
                value={form.addressZip}
                onChange={(e) => update("addressZip", e.target.value)}
                autoComplete="postal-code"
              />
            </label>
          </div>
          <p className="text-xs text-ink-muted">
            EIN, banking, and KYB go directly to Stripe Connect in the next
            phase. We do not store any of that here.
          </p>
        </section>
      )}

      {error ? (
        <div className="mt-4 text-xs text-red-600" role="alert">
          {error}
        </div>
      ) : null}

      <div className="mt-6 flex justify-between">
        <button
          type="button"
          className="btn-ghost"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0 || submitting}
        >
          Back
        </button>
        {step < STEPS.length - 1 ? (
          <button
            type="button"
            className="btn-primary"
            disabled={!canAdvance()}
            onClick={() => setStep((s) => s + 1)}
          >
            Continue
          </button>
        ) : (
          <button
            type="button"
            className="btn-primary"
            disabled={!canAdvance() || submitting}
            onClick={handleSubmit}
          >
            {submitting ? "Saving" : "Finish"}
          </button>
        )}
      </div>
    </div>
  );
}

function Stepper({ current }: { current: number }) {
  return (
    <ol className="flex items-center gap-3 text-xs">
      {STEPS.map((s, i) => {
        const state =
          i < current ? "done" : i === current ? "active" : "pending";
        return (
          <li key={s.id} className="flex items-center gap-2">
            <span
              className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-medium ${
                state === "active"
                  ? "bg-brand-lavender text-white"
                  : state === "done"
                    ? "bg-brand-lavender text-white"
                    : "bg-brand-cream/60 text-ink-muted"
              }`}
            >
              {i + 1}
            </span>
            <span
              className={`${
                state === "pending" ? "text-ink-muted" : "text-ink"
              } ${state === "active" ? "font-medium" : ""}`}
            >
              {s.title}
            </span>
            {i < STEPS.length - 1 && (
              <span className="w-6 h-px bg-brand-neutral" />
            )}
          </li>
        );
      })}
    </ol>
  );
}
