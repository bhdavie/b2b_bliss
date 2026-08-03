"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { selectPms, type PmsType } from "@/lib/api";

// Property picks which property system it runs on. Mews and Cloudbeds are the
// two options: on either rail the PMS executes the charge through its own
// gateway, so connecting it is the whole payment setup. Stripe is not offered
// here — it is the demo and no-PMS rail, reached from account settings, not a
// step in this funnel.
//
// The rows are the settled selectable-row treatment: OnboardingChecklist's
// 12px-radius row with a violet border on the one you are on, filled with the
// violet tint the sidebar and bookings table use for an active item. The name
// and blurb take the Overview connection row's sizes. The coming-soon tag is
// sand-on-ink rather than violet, so it stays legible on the tinted selected
// row (no option sets the flag today).

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
        <p className="mb-5 rounded-xl bg-red-50 px-4 py-3 text-base text-red-700">{error}</p>
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
                "flex w-full items-center gap-5 rounded-xl border px-7 py-6 text-left transition-colors",
                active
                  ? "border-brand-violet bg-brand-violet-tint"
                  : "border-sand-200 bg-white hover:border-brand-violet",
                submitting !== null && !busy ? "opacity-60" : "",
              ].join(" ")}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-3">
                  <span className="text-[19px] font-medium tracking-[-0.012em] text-ink-900">
                    {opt.name}
                  </span>
                  {opt.comingSoon ? (
                    <span className="rounded-full bg-sand-100 px-[15px] py-[7px] text-[13px] font-medium uppercase tracking-[0.06em] text-ink-400">
                      Coming soon
                    </span>
                  ) : null}
                </div>
                <p className="mt-2 text-base text-ink-400">{opt.blurb}</p>
              </div>
              <span className="shrink-0 text-base font-medium text-brand-violet">
                {busy ? "Saving" : opt.comingSoon ? "Select" : "Connect"}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
