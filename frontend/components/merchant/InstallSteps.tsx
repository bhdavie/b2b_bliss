// Step indicator for the Mews-install onboarding flow. Steps 1 (install) is
// always complete by the time these render; the active step is highlighted.

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
    <ol className="flex items-center justify-center gap-2 text-xs">
      {STEPS.map((step, i) => {
        const state =
          i < currentIndex ? "done" : i === currentIndex ? "active" : "todo";
        return (
          <li key={step.key} className="flex items-center gap-2">
            <span
              className={[
                "flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-medium",
                state === "done"
                  ? "bg-emerald-100 text-emerald-700"
                  : state === "active"
                    ? "bg-brand-navy text-white"
                    : "bg-brand-cream text-ink-muted",
              ].join(" ")}
            >
              {state === "done" ? "✓" : i + 1}
            </span>
            <span
              className={
                state === "active"
                  ? "font-medium text-ink"
                  : "text-ink-muted"
              }
            >
              {step.label}
            </span>
            {i < STEPS.length - 1 ? (
              <span className="mx-1 h-px w-6 bg-brand-neutral" />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
