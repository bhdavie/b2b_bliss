"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { activateOnboarding, type OnboardingStatus, type PmsType } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Panel, SectionHeading } from "@/components/ui/primitives";

// Setup checklist shown on the dashboard until the property reaches `active`.
// Each step links to its page; the final step activates the property.

// `none` is the default for a property that has not chosen yet. It never
// reaches a label in practice — pmsChosen gates every read of PMS_LABEL — but
// the Record is exhaustive over PmsType, so it needs an entry. `stripe` is the
// legacy no-PMS rail; no new property can land on it.
const PMS_LABEL: Record<PmsType, string> = {
  none: "Not chosen",
  stripe: "Stripe",
  mews: "Mews",
  cloudbeds: "Cloudbeds",
};

// Only the two connectable rails have a connect screen. Anything else (none,
// or a legacy stripe property) goes back to the PMS picker rather than to the
// removed /onboarding/connect-stripe.
function connectHref(pms: PmsType): string {
  if (pms === "mews") return "/onboarding/connect-mews";
  if (pms === "cloudbeds") return "/onboarding/connect-cloudbeds";
  return "/onboarding/pms";
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
    <Panel variant="filled" className="p-5">
      <div className="flex items-baseline justify-between gap-3">
        {/* Was 22px medium ink-900, one of eight competing in-card heading
            treatments. On the app's single one now, like every other card. */}
        <SectionHeading>Finish setting up your property</SectionHeading>
        <span className="flex-none text-[14px] text-ink-500">
          {status.steps.filter((s) => s.done && s.key !== "active").length} of {items.length} done
        </span>
      </div>
      <p className="mt-2 text-[14px] text-ink-500">
        A few quick steps and you can start taking payment plans.
      </p>

      <ol className="mt-3 space-y-2">
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
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold",
                  isDone
                    ? "bg-brand-violet text-white"
                    : isCurrent
                      ? "bg-brand-lavender text-brand-violet-deep"
                      : "bg-sand-200 text-ink-500",
                ].join(" ")}
              >
                {isDone ? "✓" : i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[14px] text-ink-900">{it.label}</div>
                <div className="mt-0.5 truncate text-[13px] text-ink-500">{it.hint}</div>
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

        {/* Visual placeholder only. Deliberately NOT an entry in `items`: that
            array drives the "of N" denominator, the currentKey nudge and the
            numbered badge, so a fifth entry there would read as a required step,
            latch the "current" highlight onto itself forever (no matching
            status.steps key means done() is false for good) and number itself 5.
            This row never calls done(), carries no key the backend knows about,
            and sits outside every completion path, so canActivate and "Go live"
            are untouched by it. */}
        <li
          aria-disabled="true"
          className="flex items-center gap-4 rounded-xl border border-sand-200 bg-sand-50 px-5 py-4"
        >
          {/* A dash rather than a number: this row is not one of the counted steps. */}
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sand-200 text-[13px] font-semibold text-ink-500">
            &ndash;
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[14px] text-ink-500">
              Connect your bank account for payouts
            </div>
            <div className="mt-0.5 truncate text-[13px] text-ink-500">
              Where your payouts will land
            </div>
          </div>
          {/* A static pill, not a Button: nothing here may read as clickable. */}
          <span className="shrink-0 rounded-full bg-sand-200 px-3 py-1 text-[12px] font-medium text-ink-500">
            Coming soon
          </span>
        </li>
      </ol>

      {/* Says out loud what the muted row and the unchanged "of N" counter imply,
          so five rows against a total of four cannot be misread as a blocked
          go-live. */}
      <p className="mt-2 text-[13px] text-ink-500">
        Payout setup is not required to go live.
      </p>

      {error ? (
        <p className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-[14px] text-red-700">{error}</p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-3">
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
          <span className="text-[14px] text-ink-500">
            Finish the steps above to go live.
          </span>
        ) : null}
      </div>
    </Panel>
  );
}
