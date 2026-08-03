// Step indicator for the Mews-install onboarding flow. Steps 1 (install) is
// always complete by the time these render; the active step is highlighted.
//
// The settled design has no horizontal step rail of its own, so the state
// treatment is inherited rather than invented: the chip sizing and done/current/
// ahead split come from OnboardingChecklist, and the current step uses the
// violet-tint-on-violet pill the sidebar, portal nav and bookings table all use
// for the active state. The connector follows the portal's schedule timeline,
// where the run behind the current position is accented and the run ahead is
// sand-300 — accented here in violet, since lavender is off this screen.

const STEPS = [
  { key: "install", label: "Install" },
  { key: "stripe", label: "Connect Stripe" },
  { key: "rules", label: "Plan rules" },
  { key: "done", label: "Dashboard" },
] as const;

type StepKey = (typeof STEPS)[number]["key"];

export function InstallSteps({ current }: { current: StepKey }) {
  const currentIndex = STEPS.findIndex((s) => s.key === current);

  return (
    <ol className="flex flex-wrap items-center gap-x-3 gap-y-2 text-base">
      {STEPS.map((step, i) => {
        const state =
          i < currentIndex ? "done" : i === currentIndex ? "active" : "todo";
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
                  state === "done" ? "bg-brand-violet" : "bg-sand-300"
                }`}
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
