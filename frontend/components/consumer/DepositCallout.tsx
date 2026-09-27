import { formatDollarsCompact } from "@/lib/publicApi";

export function DepositCallout({
  todayCents,
  remainingCents,
  depositRate,
}: {
  todayCents: number;
  remainingCents: number;
  depositRate: number;
}) {
  const percent = Math.round(depositRate * 100);

  return (
    <section
      className="mt-6 rounded-card border border-brand-violet/20 bg-brand-violet-tint px-4 py-4 text-ink-900"
      aria-label="Deposit required today"
    >
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-[13px] font-medium text-brand-violet-deep">
          Pay today
        </div>
        <div className="text-[12px] text-ink-500">{percent}% deposit</div>
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-[28px] font-medium tabular-nums leading-none text-brand-violet-deep">
          {formatDollarsCompact(todayCents)}
        </span>
        <span className="text-[12px] text-ink-500">deposit secures this booking</span>
      </div>
      <div className="mt-3 text-[12px] text-ink-500">
        Remaining {formatDollarsCompact(remainingCents)} divides into the
        installments below.
      </div>
    </section>
  );
}
