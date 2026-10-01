"use client";

import { formatMoneyCompact, splitInstallments, type MoneyContext } from "@/lib/money";
import {
  formatScheduleDateShort,
  type PublicPlanFrequency,
  type PublicPlanOption,
} from "@/lib/publicApi";
import { SectionLabel } from "./SectionLabel";

export function PlanPicker({
  options,
  selected,
  onSelect,
  remainingCents,
  money,
}: {
  options: PublicPlanOption[];
  selected: PublicPlanFrequency;
  onSelect: (frequency: PublicPlanFrequency) => void;
  remainingCents: number;
  money: MoneyContext;
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
            money={money}
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
  money,
}: {
  option: PublicPlanOption;
  isSelected: boolean;
  isOnly: boolean;
  onSelect: () => void;
  remainingCents: number;
  money: MoneyContext;
}) {
  const visuallySelected = isSelected || isOnly;
  const finalDate = option.dueDates[option.dueDates.length - 1] ?? "";
  // The regular per-payment amount: the backend split puts any remainder on
  // the last payment, so payment 1 is the one every other payment matches.
  const perPaymentCents = splitInstallments(remainingCents, option.numPayments)[0] ?? 0;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={visuallySelected}
      // Selected: amethyst outline (border plus a 1px ring, so the card does
      // not grow a pixel against its neighbours) on the wash.
      className={`relative w-full rounded-card border px-4 py-3.5 text-left transition-colors ${
        visuallySelected
          ? "border-brand-violet bg-brand-violet-tint ring-1 ring-brand-violet"
          : "border-sand-200 bg-white hover:bg-sand-hover"
      }`}
    >
      {option.recommended ? (
        <span
          className="absolute -top-[10px] left-[14px] rounded-full border border-brand-violet/30 bg-white px-2 py-0.5 text-[11px] font-medium text-brand-violet-deep"
          aria-label="Recommended option"
        >
          Recommended
        </span>
      ) : null}
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <div
            className={`text-[14px] font-medium ${
              visuallySelected ? "text-brand-violet-deep" : "text-ink-900"
            }`}
          >
            {option.frequency === "biweekly" ? "Every 2 weeks" : "Monthly"}
          </div>
          <div className="mt-0.5 text-[12px] text-ink-500">
            {option.numPayments} payments through{" "}
            {formatScheduleDateShort(finalDate, money.locale)}
          </div>
        </div>
        <div className="flex-none text-right">
          <div
            className={`text-[16px] font-semibold tabular-nums ${
              visuallySelected ? "text-brand-violet-deep" : "text-ink-900"
            }`}
          >
            {formatMoneyCompact(perPaymentCents, money)}
          </div>
          <div className="text-[11px] text-ink-500">/payment</div>
        </div>
      </div>
    </button>
  );
}
