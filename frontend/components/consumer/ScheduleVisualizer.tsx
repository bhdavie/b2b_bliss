import {
  formatDollarsCompact,
  formatScheduleDatePill,
  type PublicPlanOption,
} from "@/lib/publicApi";

export function ScheduleVisualizer({ option }: { option: PublicPlanOption }) {
  const pills = option.dueDates.map((d, i) => {
    const isFinal = i === option.dueDates.length - 1;
    const amount = isFinal
      ? option.finalPaymentAmountCents
      : option.perPaymentAmountCents;
    return { dateLabel: formatScheduleDatePill(d), amount, isFinal };
  });

  const wrapToTwoRows = pills.length > 8;

  return (
    <section className="mt-6">
      <div className="flex items-baseline justify-between">
        <SectionLabel>Your schedule</SectionLabel>
        {pills.some((p) => p.amount !== pills[0]?.amount) ? (
          <span className="text-[10px] text-ink-soft">
            Final payment: {formatDollarsCompact(pills[pills.length - 1]?.amount ?? 0)}
          </span>
        ) : null}
      </div>
      <div
        className={`mt-2.5 flex gap-[5px] ${wrapToTwoRows ? "flex-wrap" : ""}`}
        role="list"
        aria-label="Payment schedule"
      >
        {pills.map((pill, i) => (
          <Pill
            key={`${pill.dateLabel}-${i}`}
            dateLabel={pill.dateLabel}
            amount={pill.amount}
            isFinal={pill.isFinal}
            grow={!wrapToTwoRows}
          />
        ))}
      </div>
    </section>
  );
}

function Pill({
  dateLabel,
  amount,
  isFinal,
  grow,
}: {
  dateLabel: string;
  amount: number;
  isFinal: boolean;
  grow: boolean;
}) {
  return (
    <div
      role="listitem"
      className={`min-w-0 ${grow ? "flex-1" : "min-w-[58px]"} rounded-sm px-1 py-[9px] text-center ${
        isFinal ? "bg-lavender-100" : "bg-cream-dark"
      }`}
    >
      <div
        className={`text-[9px] font-medium uppercase tracking-[0.5px] ${
          isFinal ? "text-lavender-700" : "text-ink-soft"
        }`}
      >
        {dateLabel}
      </div>
      <div
        className={`mt-0.5 text-[11px] font-medium tabular-nums ${
          isFinal ? "text-navy" : "text-lavender-700"
        }`}
      >
        {formatDollarsCompact(amount)}
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-medium uppercase tracking-[0.6px] text-ink-muted">
      {children}
    </div>
  );
}
