"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { updateMerchant, type UpdateMerchantPayload } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Panel } from "@/components/ui/primitives";

type FormState = {
  businessName: string;
  businessType: string;
  numberOfRooms: string;
  phone: string;
  addressLine1: string;
  addressLine2: string;
  addressCity: string;
  addressState: string;
  addressZip: string;
};

const BUSINESS_TYPES = [
  { value: "boutique_hotel", label: "Boutique hotel" },
  { value: "independent_hotel", label: "Independent hotel" },
  { value: "resort", label: "Resort" },
  { value: "inn_bnb", label: "Inn / B&B" },
  { value: "lodge", label: "Lodge" },
];

const ROOM_COUNTS = [
  { value: "under_25", label: "Under 25 rooms" },
  { value: "25_75", label: "25 to 75 rooms" },
  { value: "76_150", label: "76 to 150 rooms" },
  { value: "151_300", label: "151 to 300 rooms" },
  { value: "301_500", label: "301 to 500 rooms" },
  { value: "500_plus", label: "500+ rooms" },
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
      router.push("/home");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
      setSubmitting(false);
    }
  }

  return (
    <Panel className="px-8 pb-8 pt-[30px]">
      <Stepper current={step} />

      {step === 0 && (
        <section className="mt-8 space-y-5">
          <label className="block">
            <span className="label">Business name</span>
            <Input
              className="mt-1.5"
              value={form.businessName}
              onChange={(e) => update("businessName", e.target.value)}
              placeholder="Marbrook House"
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
          <label className="block">
            <span className="label">Number of rooms</span>
            <select
              className="input mt-1.5 bg-white"
              value={form.numberOfRooms}
              onChange={(e) => update("numberOfRooms", e.target.value)}
            >
              <option value="">Pick one</option>
              {ROOM_COUNTS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
        </section>
      )}

      {step === 1 && (
        <section className="mt-8 space-y-5">
          <label className="block">
            <span className="label">Phone (optional)</span>
            <Input
              className="mt-1.5"
              value={form.phone}
              onChange={(e) => update("phone", e.target.value)}
              placeholder="(555) 123-4567"
              type="tel"
            />
          </label>
          <p className="text-base text-ink-400">
            We will not text customers from your number. This is for your account
            only.
          </p>
        </section>
      )}

      {step === 2 && (
        <section className="mt-8 space-y-5">
          <label className="block">
            <span className="label">Street address</span>
            <Input
              className="mt-1.5"
              value={form.addressLine1}
              onChange={(e) => update("addressLine1", e.target.value)}
              autoComplete="address-line1"
            />
          </label>
          <label className="block">
            <span className="label">Suite or unit (optional)</span>
            <Input
              className="mt-1.5"
              value={form.addressLine2}
              onChange={(e) => update("addressLine2", e.target.value)}
              autoComplete="address-line2"
            />
          </label>
          <div className="grid grid-cols-3 gap-4">
            <label className="block col-span-1">
              <span className="label">City</span>
              <Input
                className="mt-1.5"
                value={form.addressCity}
                onChange={(e) => update("addressCity", e.target.value)}
                autoComplete="address-level2"
              />
            </label>
            <label className="block col-span-1">
              <span className="label">State</span>
              <Input
                className="mt-1.5"
                value={form.addressState}
                onChange={(e) => update("addressState", e.target.value)}
                autoComplete="address-level1"
                placeholder="CA"
                maxLength={2}
              />
            </label>
            <label className="block col-span-1">
              <span className="label">Zip</span>
              <Input
                className="mt-1.5"
                value={form.addressZip}
                onChange={(e) => update("addressZip", e.target.value)}
                autoComplete="postal-code"
              />
            </label>
          </div>
          <p className="text-base text-ink-400">
            EIN, banking, and KYB go directly to Stripe Connect in the next
            phase. We do not store any of that here.
          </p>
        </section>
      )}

      {error ? (
        <div className="mt-6 text-base text-red-700" role="alert">
          {error}
        </div>
      ) : null}

      <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t border-sand-100 pt-6">
        <Button
          type="button"
          variant="ghost"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0 || submitting}
        >
          Back
        </Button>
        {step < STEPS.length - 1 ? (
          <Button
            type="button"
            variant="merchant"
            disabled={!canAdvance()}
            onClick={() => setStep((s) => s + 1)}
          >
            Continue
          </Button>
        ) : (
          <Button
            type="button"
            variant="merchant"
            disabled={!canAdvance() || submitting}
            onClick={handleSubmit}
          >
            {submitting ? "Saving" : "Finish"}
          </Button>
        )}
      </div>
    </Panel>
  );
}

// The three panes of THIS form, not the funnel's four steps. The funnel rail
// (InstallSteps) now sits directly above this panel on the same screen, so this
// deliberately drops the numbered chips and the connector that would make the
// two read as the same indicator: it is the settled tab treatment instead, an
// underlined label row inside the panel it belongs to.
//
// Behaviour is untouched. The panes are still driven by the wizard's own local
// index, and they are still spans, not buttons: nothing here is clickable, and
// which pane is on screen is still moved only by Back and Continue.
function Stepper({ current }: { current: number }) {
  return (
    <ol className="-mt-1 flex gap-9 overflow-x-auto border-b border-sand-300">
      {STEPS.map((s, i) => {
        const state =
          i < current ? "done" : i === current ? "active" : "pending";
        return (
          <li
            key={s.id}
            aria-current={state === "active" ? "step" : undefined}
            className={`whitespace-nowrap px-0.5 pb-4 text-[17px] ${
              state === "active"
                ? "font-medium tracking-[-0.01em] text-brand-violet shadow-[inset_0_-2px_0_#8B5CF6]"
                : state === "done"
                  ? "text-ink-900"
                  : "text-ink-400"
            }`}
          >
            {s.title}
          </li>
        );
      })}
    </ol>
  );
}
