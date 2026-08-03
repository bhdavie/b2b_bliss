import type { OnboardingStatus } from "@/lib/api";

// The onboarding funnel's progress rail, shown on every funnel screen.
//
// It reads the backend's own onboarding state rather than a per-page literal.
// PropertyOnboardingService.steps() emits one flag per state in the machine
// (account, pms_selected, pms_connected, policy_set, active); each rail step
// below names the flag that proves it, so a step only reads as complete when
// the backend says the property actually reached that state.
//
// `account` is deliberately not drawn: it is true for anyone holding a session,
// so it would be a step no merchant could ever be on. The wizard at /onboarding
// that collects business details has no flag of its own in the machine, so it
// is not a rail step either; a property sitting on it is still on step 1.
//
// State treatment is unchanged: violet chip for a completed step, the
// violet-tint-on-violet pill for the step you are on, sand for what is ahead,
// and a connector that is violet behind the position and sand-300 in front.

const STEPS = [
  { key: "pms_selected", label: "Property system" },
  { key: "pms_connected", label: "Connect" },
  { key: "policy_set", label: "Plan rules" },
  { key: "active", label: "Dashboard" },
] as const;

export function InstallSteps({ status }: { status: OnboardingStatus | null }) {
  const isDone = (key: string) =>
    status?.steps.find((s) => s.key === key)?.done ?? false;

  // The step you are on is the first one the backend has not recorded. When
  // every flag is set there is no current step, which is the live property's
  // resting state.
  const currentIndex = STEPS.findIndex((s) => !isDone(s.key));

  return (
    <ol className="flex flex-wrap items-center gap-x-3 gap-y-2 text-base">
      {STEPS.map((step, i) => {
        const done = isDone(step.key);
        const state = done ? "done" : i === currentIndex ? "active" : "todo";
        return (
          <li key={step.key} className="flex items-center gap-3">
            <span
              className={[
                "flex h-7 w-7 flex-none items-center justify-center rounded-full text-sm font-semibold",
                state === "done"
                  ? "bg-brand-violet text-white"
                  : state === "active"
                    ? "bg-brand-violet-tint text-brand-violet"
                    : "bg-sand-200 text-ink-400",
              ].join(" ")}
            >
              {state === "done" ? "✓" : i + 1}
            </span>
            <span
              className={
                state === "active"
                  ? "font-medium text-ink-900"
                  : "text-ink-400"
              }
            >
              {step.label}
            </span>
            {i < STEPS.length - 1 ? (
              <span
                className={`mx-1 h-px w-8 ${
                  done ? "bg-brand-violet" : "bg-sand-300"
                }`}
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
