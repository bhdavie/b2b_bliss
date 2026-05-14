import {
  formatDollarsCompact,
  formatScheduleDatePill,
  type PublicPlanOption,
} from "@/lib/publicApi";

type Pill = {
  kind: "deposit" | "installment";
  dateLabel: string;
  amount: number;
  isFinal: boolean;
};

export function ScheduleVisualizer({
  option,
  depositAmountCents = 0,
}: {
  option: PublicPlanOption;
  depositAmountCents?: number;
}) {
  const installmentPills: Pill[] = option.dueDates.map((d, i) => {
    const isFinal = i === option.dueDates.length - 1;
    return {
      kind: "installment",
      dateLabel: formatScheduleDatePill(d),
      amount: isFinal ? option.finalPaymentAmountCents : option.perPaymentAmountCents,
      isFinal,
    };
  });

  const pills: Pill[] = depositAmountCents > 0
    ? [
        {
          kind: "deposit",
          dateLabel: "TODAY",
          amount: depositAmountCents,
          isFinal: false,
        },
        ...installmentPills,
      ]
    : installmentPills;

  const wrapToTwoRows = pills.length > 8;
  const finalInstallment = installmentPills[installmentPills.length - 1];
  const firstInstallment = installmentPills[0];
  const showFinalNote =
    finalInstallment != null
    && firstInstallment != null
    && finalInstallment.amount !== firstInstallment.amount;

  return (
    <section className="mt-6">
      <div className="flex items-baseline justify-between">
        <SectionLabel>Your schedule</SectionLabel>
        {showFinalNote ? (
          <span className="text-[10px] text-ink-soft">
            Final payment: {formatDollarsCompact(finalInstallment.amount)}
          </span>
        ) : null}
      </div>
      <div
        className={`mt-2.5 flex gap-[5px] ${wrapToTwoRows ? "flex-wrap" : ""}`}
        role="list"
        aria-label="Payment schedule"
      >
        {pills.map((pill, i) => (
          <PillView
            key={`${pill.kind}-${pill.dateLabel}-${i}`}
            pill={pill}
            grow={!wrapToTwoRows}
          />
        ))}
      </div>
    </section>
  );
}

function PillView({ pill, grow }: { pill: Pill; grow: boolean }) {
  if (pill.kind === "deposit") {
    return (
      <div
        role="listitem"
        className={`min-w-0 ${grow ? "flex-1" : "min-w-[58px]"} rounded-sm border border-navy/30 bg-navy px-1 py-[9px] text-center text-white`}
      >
        <div className="text-[9px] font-medium uppercase tracking-[0.5px] text-dusty-blue">
          Deposit
        </div>
        <div className="mt-0.5 text-[11px] font-medium tabular-nums">
          {formatDollarsCompact(pill.amount)}
        </div>
      </div>
    );
  }
  return (
    <div
      role="listitem"
      className={`min-w-0 ${grow ? "flex-1" : "min-w-[58px]"} rounded-sm px-1 py-[9px] text-center ${
        pill.isFinal ? "bg-lavender-100" : "bg-cream-dark"
      }`}
    >
      <div
        className={`text-[9px] font-medium uppercase tracking-[0.5px] ${
          pill.isFinal ? "text-lavender-700" : "text-ink-soft"
        }`}
      >
        {pill.dateLabel}
      </div>
      <div
        className={`mt-0.5 text-[11px] font-medium tabular-nums ${
          pill.isFinal ? "text-navy" : "text-lavender-700"
        }`}
      >
        {formatDollarsCompact(pill.amount)}
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
