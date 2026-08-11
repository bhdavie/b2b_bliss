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
  remainingCents,
}: {
  options: PublicPlanOption[];
  selected: PublicPlanFrequency;
  onSelect: (frequency: PublicPlanFrequency) => void;
  remainingCents: number;
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
            remainingCents={remainingCents}
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
  remainingCents,
}: {
  option: PublicPlanOption;
  isSelected: boolean;
  isOnly: boolean;
  onSelect: () => void;
  remainingCents: number;
}) {
  const visuallySelected = isSelected || isOnly;
  const finalDate = option.dueDates[option.dueDates.length - 1] ?? "";
  const perPaymentCents =
    option.numPayments > 0
      ? Math.round(remainingCents / option.numPayments)
      : 0;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={visuallySelected}
      className={`relative w-full rounded-none px-4 py-3.5 text-left transition-colors ${
        visuallySelected
          ? "border-2 border-[#D6C8FB] bg-brand-lavender/20"
          : "border-[0.5px] border-brand-neutral bg-white hover:border-brand-dusty"
      }`}
    >
      {option.recommended ? (
        <span
          className="absolute -top-[9px] left-[14px] rounded-none bg-brand-lavender px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.3px] text-white"
          aria-label="Recommended option"
        >
          Recommended
        </span>
      ) : null}
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <div
            className={`text-[14px] font-medium ${
              visuallySelected ? "text-brand-purple" : "text-brand-navy"
            }`}
          >
            {option.frequency === "biweekly" ? "Every 2 weeks" : "Monthly"}
          </div>
          <div className="mt-0.5 text-[12px] text-brand-navy/60">
            {option.numPayments} payments through{" "}
            {formatScheduleDateShort(finalDate)}
          </div>
        </div>
        <div className="flex-none text-right">
          <div
            className={`text-[16px] font-semibold tabular-nums ${
              visuallySelected ? "text-brand-purple" : "text-brand-navy"
            }`}
          >
            {formatDollarsCompact(perPaymentCents)}
          </div>
          <div className="text-[11px] text-brand-navy/60">/payment</div>
        </div>
      </div>
    </button>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-medium uppercase tracking-[0.6px] text-brand-navy/60">
      {children}
    </div>
  );
}
