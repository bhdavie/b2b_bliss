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
      className="mt-6 rounded-md border-2 border-brand-purple/10 bg-brand-purple text-white px-4 py-4"
      aria-label="Deposit required today"
    >
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-[11px] font-medium uppercase tracking-[0.6px] text-white/80">
          Pay today
        </div>
        <div className="text-[11px] text-white/80">{percent}% deposit</div>
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-[28px] font-medium tabular-nums leading-none">
          {formatDollarsCompact(todayCents)}
        </span>
        <span className="text-[12px] text-white/80">deposit secures this booking</span>
      </div>
      <div className="mt-3 text-[12px] text-white/80">
        Remaining {formatDollarsCompact(remainingCents)} divides into the
        installments below.
      </div>
    </section>
  );
}
