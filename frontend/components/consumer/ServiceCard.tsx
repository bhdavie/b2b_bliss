import {
  formatDollarsCompact,
  formatScheduleDateLong,
  type PublicBooking,
} from "@/lib/publicApi";
import { feeFor } from "@/lib/blissFee";

export function ServiceCard({
  service,
  originalTotalCents,
  discountedTotalCents,
}: {
  service: PublicBooking["service"];
  originalTotalCents?: number;
  discountedTotalCents?: number;
}) {
  const hasDiscount =
    originalTotalCents !== undefined &&
    discountedTotalCents !== undefined &&
    originalTotalCents > discountedTotalCents;
  const savings = hasDiscount ? originalTotalCents - discountedTotalCents : 0;
  const percent = hasDiscount
    ? Math.round((savings / originalTotalCents) * 100)
    : 0;
  const subtotalCents = originalTotalCents ?? service.totalAmountCents;
  const baseTotalCents =
    discountedTotalCents ?? originalTotalCents ?? service.totalAmountCents;
  const processingFeeCents = feeFor(baseTotalCents);
  const displayedTotalCents = baseTotalCents + processingFeeCents;

  return (
    <section className="mt-5 rounded-md bg-brand-cream/60 p-4">
      <div className="text-[14px] font-medium text-ink">{service.name}</div>
      <div className="mt-0.5 text-[12px] text-ink-muted">
        {formatScheduleDateLong(service.appointmentDate)}
      </div>
      <div className="mt-5 flex items-baseline justify-between border-t border-ink/10 pt-3">
        <div className="text-[12px] text-ink-muted">Subtotal</div>
        <div
          className={`text-[12px] text-ink-muted tabular-nums${hasDiscount ? " line-through" : ""}`}
        >
          {formatDollarsCompact(subtotalCents)}
        </div>
      </div>
      {hasDiscount ? (
        <div className="mt-1 flex items-baseline justify-between">
          <div className="text-[12px] text-emerald-700">
            Plan discount ({percent}%)
          </div>
          <div className="text-[12px] text-emerald-700 tabular-nums">
            -{formatDollarsCompact(savings)}
          </div>
        </div>
      ) : null}
      <div className="mt-1 flex items-baseline justify-between">
        <div className="text-[12px] text-ink-muted">Processing fee</div>
        <div className="text-[12px] text-ink-muted tabular-nums">
          +{formatDollarsCompact(processingFeeCents)}
        </div>
      </div>
      <div className="mt-3 flex items-baseline justify-between">
        <div className="text-[12px] text-ink-muted">Total</div>
        <div className="text-[24px] font-medium leading-none text-ink">
          {formatDollarsCompact(displayedTotalCents)}
        </div>
      </div>
    </section>
  );
}
