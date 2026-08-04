"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { activateOnboarding, type OnboardingStatus, type PmsType } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/primitives";

// Setup checklist shown on the dashboard until the property reaches `active`.
// Each step links to its page; the final step activates the property.

const PMS_LABEL: Record<PmsType, string> = {
  stripe: "Stripe",
  mews: "Mews",
  cloudbeds: "Cloudbeds",
};

function connectHref(pms: PmsType): string | null {
  if (pms === "mews") return "/onboarding/connect-mews";
  if (pms === "cloudbeds") return "/onboarding/connect-cloudbeds";
  return "/onboarding/connect-stripe";
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
          ? status.cloudbeds?.connected
            ? `${status.cloudbeds.propertyName ?? "Connected"} · ${status.cloudbeds.currency ?? ""}`
            : "Authorize Cloudbeds with OAuth"
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
    <Panel variant="filled" className="px-7 py-[30px]">
      <div className="flex items-baseline justify-between gap-6">
        <h2 className="text-[22px] font-medium tracking-[-0.015em] text-ink-900">
          Finish setting up your property
        </h2>
        <span className="flex-none text-base text-ink-400">
          {status.steps.filter((s) => s.done && s.key !== "active").length} of {items.length} done
        </span>
      </div>
      <p className="mt-2 text-[17px] text-ink-500">
        A few quick steps and you can start taking payment plans.
      </p>

      <ol className="mt-6 space-y-2">
        {items.map((it, i) => {
          const isDone = done(it.key);
          const isCurrent = it.key === currentKey;
          return (
            <li
              key={it.key}
              className={[
                "flex items-center gap-4 rounded-xl border bg-white px-5 py-4",
                isCurrent ? "border-brand-violet" : "border-sand-200",
              ].join(" ")}
            >
              <span
                className={[
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
                  isDone
                    ? "bg-brand-violet text-white"
                    : isCurrent
                      ? "bg-brand-lavender text-brand-violet-deep"
                      : "bg-sand-200 text-ink-400",
                ].join(" ")}
              >
                {isDone ? "✓" : i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-base font-medium text-ink-900">{it.label}</div>
                <div className="mt-0.5 truncate text-sm text-ink-400">{it.hint}</div>
              </div>
              {!isDone && it.href ? (
                <Button
                  href={it.href}
                  variant={isCurrent ? "primary" : "ghost"}
                  className="shrink-0"
                >
                  {isCurrent ? "Continue" : "Open"}
                </Button>
              ) : null}
            </li>
          );
        })}
      </ol>

      {error ? (
        <p className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-base text-red-700">{error}</p>
      ) : null}

      <div className="mt-6 flex flex-wrap items-center gap-4">
        <Button
          type="button"
          onClick={handleActivate}
          disabled={!canActivate || activating}
          variant="primary"
          className="disabled:opacity-50"
        >
          {activating ? "Going live" : "Go live"}
        </Button>
        {!canActivate ? (
          <span className="text-base text-ink-400">
            Finish the steps above to go live.
          </span>
        ) : null}
      </div>
    </Panel>
  );
}
