import {
  formatDollarsCompact,
  formatScheduleDateLong,
  type PublicBooking,
} from "@/lib/publicApi";
import { feeForAtRate } from "@/lib/blissFee";

export function ServiceCard({
  service,
  originalTotalCents,
  discountedTotalCents,
  feeRate,
}: {
  service: PublicBooking["service"];
  originalTotalCents?: number;
  discountedTotalCents?: number;
  // The property's rate, resolved by whoever has the slug. Required rather
  // than defaulted: a silent default here is how the hardcoded 5% survived.
  feeRate: number;
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
  const processingFeeCents = feeForAtRate(baseTotalCents, feeRate);
  const displayedTotalCents = baseTotalCents + processingFeeCents;

  return (
    <section className="mt-5 rounded-card bg-sand-100 p-4">
      <div className="text-[14px] font-medium text-ink-900">{service.name}</div>
      <div className="mt-0.5 text-[12px] text-ink-500">
        {formatScheduleDateLong(service.appointmentDate)}
      </div>
      <div className="mt-5 flex items-baseline justify-between border-t border-sand-200 pt-3">
        <div className="text-[12px] text-ink-500">Subtotal</div>
        <div
          className={`text-[12px] text-ink-500 tabular-nums${hasDiscount ? " line-through" : ""}`}
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
      {processingFeeCents > 0 ? (
        <div className="mt-1 flex items-baseline justify-between">
          <div className="text-[12px] text-ink-500">Processing fee</div>
          <div className="text-[12px] text-ink-500 tabular-nums">
            +{formatDollarsCompact(processingFeeCents)}
          </div>
        </div>
      ) : null}
      <div className="mt-3 flex items-baseline justify-between">
        <div className="text-[12px] text-ink-500">Total</div>
        <div className="text-[24px] font-semibold leading-none text-ink-900">
          {formatDollarsCompact(displayedTotalCents)}
        </div>
      </div>
    </section>
  );
}
