"use client";

import {
  formatDollarsCompact,
  formatScheduleDateShort,
  type PublicPlanFrequency,
  type PublicPlanOption,
} from "@/lib/publicApi";

export function PlanPicker({
  options,
  selected,
  onSelect,
}: {
  options: PublicPlanOption[];
  selected: PublicPlanFrequency;
  onSelect: (frequency: PublicPlanFrequency) => void;
}) {
  return (
    <section className="mt-6">
      <SectionLabel>Choose your plan</SectionLabel>
      <div className="mt-2.5 grid gap-2.5">
        {options.map((option) => (
          <PlanCard
            key={option.frequency}
            option={option}
            isSelected={option.frequency === selected}
            isOnly={options.length === 1}
            onSelect={() => onSelect(option.frequency)}
          />
        ))}
      </div>
    </section>
  );
}

function PlanCard({
  option,
  isSelected,
  isOnly,
  onSelect,
}: {
  option: PublicPlanOption;
  isSelected: boolean;
  isOnly: boolean;
  onSelect: () => void;
}) {
  const visuallySelected = isSelected || isOnly;
  const finalDate = option.dueDates[option.dueDates.length - 1] ?? "";

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={visuallySelected}
      className={`relative w-full rounded-md px-4 py-3.5 text-left transition-colors ${
        visuallySelected
          ? "border-2 border-lavender-500 bg-[#FAFAFD]"
          : "border-[0.5px] border-surface-border bg-white hover:border-lavender-300"
      }`}
    >
      {option.recommended ? (
        <span
          className="absolute -top-[9px] left-[14px] rounded-[10px] bg-lavender-500 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.3px] text-white"
          aria-label="Recommended option"
        >
          Recommended
        </span>
      ) : null}
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <div
            className={`text-[14px] font-medium ${
              visuallySelected ? "text-lavender-700" : "text-ink"
            }`}
          >
            {option.frequency === "biweekly" ? "Every 2 weeks" : "Monthly"}
          </div>
          <div className="mt-0.5 text-[12px] text-ink-muted">
            {option.numPayments} payments through{" "}
            {formatScheduleDateShort(finalDate)}
          </div>
        </div>
        <div className="flex-none text-right">
          <div
            className={`text-[16px] font-medium tabular-nums ${
              visuallySelected ? "text-lavender-700" : "text-ink"
            }`}
          >
            {formatDollarsCompact(option.perPaymentAmountCents)}
          </div>
          <div className="text-[11px] text-ink-soft">/payment</div>
        </div>
      </div>
    </button>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-medium uppercase tracking-[0.6px] text-ink-muted">
      {children}
    </div>
  );
}
