"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { selectPms, type PmsType } from "@/lib/api";

// Property picks where it takes payments. Mews, Cloudbeds, and Stripe are all
// connectable now.

type Option = {
  key: PmsType;
  name: string;
  blurb: string;
  comingSoon?: boolean;
};

const OPTIONS: Option[] = [
  {
    key: "mews",
    name: "Mews",
    blurb: "Charge cards vaulted in your Mews property. Connect with your Connector API tokens.",
  },
  {
    key: "cloudbeds",
    name: "Cloudbeds",
    blurb: "Charge cards from your Cloudbeds property. Connect with OAuth.",
  },
  {
    key: "stripe",
    name: "Stripe only",
    blurb: "No PMS. Collect and charge cards directly with Stripe.",
  },
];

export function PmsSelectStep({ currentPms }: { currentPms: PmsType }) {
  const router = useRouter();
  const [choice, setChoice] = useState<PmsType | null>(null);
  const [submitting, setSubmitting] = useState<PmsType | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function choose(pms: PmsType) {
    setError(null);
    setChoice(pms);
    setSubmitting(pms);
    try {
      await selectPms(pms);
      if (pms === "mews") {
        router.push("/onboarding/connect-mews");
      } else if (pms === "cloudbeds") {
        router.push("/onboarding/connect-cloudbeds");
      } else {
        router.push("/onboarding/connect-stripe");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save your choice. Try again.");
      setSubmitting(null);
    }
  }

  return (
    <div>
      {error ? (
        <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      <div className="space-y-3">
        {OPTIONS.map((opt) => {
          const active = (choice ?? currentPms) === opt.key;
          const busy = submitting === opt.key;
          return (
            <button
              key={opt.key}
              type="button"
              onClick={() => choose(opt.key)}
              disabled={submitting !== null}
              className={[
                "flex w-full items-center gap-4 rounded-lg border px-5 py-4 text-left transition-colors",
                active ? "border-brand-purple bg-brand-cream/40" : "border-brand-neutral bg-white hover:border-brand-purple/50",
                submitting !== null && !busy ? "opacity-60" : "",
              ].join(" ")}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-base font-semibold text-brand-navy">{opt.name}</span>
                  {opt.comingSoon ? (
                    <span className="rounded-full bg-brand-cream px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                      Coming soon
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-sm text-brand-navy/65">{opt.blurb}</p>
              </div>
              <span className="shrink-0 text-sm font-medium text-brand-purple">
                {busy ? "Saving" : opt.comingSoon ? "Select" : "Connect"}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
