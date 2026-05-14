import { formatDollarsCompact } from "@/lib/publicApi";

/**
 * "Pay today: $X deposit" callout — sits above the plan picker so the
 * customer sees the upfront commitment before scanning installment options.
 * Visually distinct from the lavender plan cards: cream background with a
 * navy accent so the deposit reads as the "secure your booking" moment.
 */
export function DepositCallout({
  depositAmountCents,
  totalAmountCents,
}: {
  depositAmountCents: number;
  totalAmountCents: number;
}) {
  const balance = totalAmountCents - depositAmountCents;
  const percent = Math.round((depositAmountCents / totalAmountCents) * 100);

  return (
    <section
      className="mt-6 rounded-md border-2 border-navy/10 bg-navy text-white px-4 py-4"
      aria-label="Deposit required today"
    >
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-[11px] font-medium uppercase tracking-[0.6px] text-dusty-blue">
          Pay today
        </div>
        <div className="text-[11px] text-dusty-blue">{percent}% deposit</div>
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-[28px] font-medium tabular-nums leading-none">
          {formatDollarsCompact(depositAmountCents)}
        </span>
        <span className="text-[12px] text-dusty-blue">deposit secures this booking</span>
      </div>
      <div className="mt-3 text-[12px] text-dusty-blue">
        Remaining {formatDollarsCompact(balance)} divides into the installments
        below.
      </div>
    </section>
  );
}
