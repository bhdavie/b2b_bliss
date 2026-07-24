"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { activateOnboarding, type OnboardingStatus, type PmsType } from "@/lib/api";

// Setup checklist shown on the dashboard until the property reaches `active`.
// Each step links to its page; the final step activates the property.

const PMS_LABEL: Record<PmsType, string> = {
  stripe: "Stripe",
  mews: "Mews",
  cloudbeds: "Cloudbeds",
};

function connectHref(pms: PmsType): string | null {
  if (pms === "mews") return "/onboarding/connect-mews";
  if (pms === "stripe") return "/onboarding/connect-stripe";
  return null; // cloudbeds: coming soon, not connectable
}

export function OnboardingChecklist({ status }: { status: OnboardingStatus }) {
  const router = useRouter();
  const [activating, setActivating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const done = (key: string) => status.steps.find((s) => s.key === key)?.done ?? false;
  const pmsChosen = done("pms_selected");
  const pmsLabel = PMS_LABEL[status.pmsType];

  const items = [
    { key: "account", label: "Create your account", href: null as string | null, hint: "Done" },
    { key: "pms_selected", label: "Choose your PMS", href: "/onboarding/pms", hint: pmsChosen ? pmsLabel : "Pick where you take payments" },
    {
      key: "pms_connected",
      label: pmsChosen ? `Connect ${pmsLabel}` : "Connect your payment rail",
      href: pmsChosen ? connectHref(status.pmsType) : "/onboarding/pms",
      hint:
        status.pmsType === "cloudbeds"
          ? "Cloudbeds is coming soon"
          : status.mews?.connected
            ? `${status.mews.enterpriseName ?? "Connected"} · ${status.mews.currency ?? ""}`
            : "Enter your credentials",
    },
    { key: "policy_set", label: "Set your payment policies", href: "/onboarding/plan-rules", hint: "Refunds, retries, deposits" },
  ];

  // First not-done step is the one we nudge.
  const currentKey = items.find((it) => !done(it.key))?.key ?? "active";
  const canActivate = done("policy_set");

  async function handleActivate() {
    setError(null);
    setActivating(true);
    try {
      await activateOnboarding();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not finish setup. Try again.");
      setActivating(false);
    }
  }

  return (
    <section className="card card-subtle mb-10 p-6">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold text-brand-navy">Finish setting up your property</h2>
        <span className="text-xs text-brand-navy/60">
          {status.steps.filter((s) => s.done && s.key !== "active").length} of {items.length} done
        </span>
      </div>
      <p className="mt-1 text-sm text-brand-navy/70">
        A few quick steps and you can start taking payment plans.
      </p>

      <ol className="mt-5 space-y-2">
        {items.map((it, i) => {
          const isDone = done(it.key);
          const isCurrent = it.key === currentKey;
          return (
            <li
              key={it.key}
              className={[
                "flex items-center gap-3 rounded-md border px-4 py-3",
                isCurrent ? "border-brand-purple bg-white" : "border-brand-neutral bg-white/60",
              ].join(" ")}
            >
              <span
                className={[
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                  isDone ? "bg-emerald-100 text-emerald-700" : isCurrent ? "bg-brand-lavender text-brand-navy-dark" : "bg-brand-cream text-ink-muted",
                ].join(" ")}
              >
                {isDone ? "✓" : i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-ink">{it.label}</div>
                <div className="mt-0.5 truncate text-xs text-brand-navy/60">{it.hint}</div>
              </div>
              {!isDone && it.href ? (
                <Link
                  href={it.href}
                  className={isCurrent ? "btn-primary-merchant shrink-0" : "btn-ghost shrink-0"}
                >
                  {isCurrent ? "Continue" : "Open"}
                </Link>
              ) : null}
            </li>
          );
        })}
      </ol>

      {error ? (
        <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      <div className="mt-5 flex items-center gap-3">
        <button
          type="button"
          onClick={handleActivate}
          disabled={!canActivate || activating}
          className="btn-primary-merchant disabled:opacity-50"
        >
          {activating ? "Going live" : "Go live"}
        </button>
        {!canActivate ? (
          <span className="text-xs text-brand-navy/55">Finish the steps above to go live.</span>
        ) : null}
      </div>
    </section>
  );
}
