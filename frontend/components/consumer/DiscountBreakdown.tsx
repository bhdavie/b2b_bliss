import { formatDollarsCompact } from "@/lib/publicApi";

/**
 * Renders the savings callout + Subtotal / Plan discount / Total breakdown on
 * the consumer checkout when the merchant has a plan discount configured.
 * Returns null when no discount applies so callers can mount it unconditionally.
 */
export function DiscountBreakdown({
  originalTotalCents,
  discountedTotalCents,
  variant = "card",
}: {
  originalTotalCents: number;
  discountedTotalCents: number;
  variant?: "card" | "rows";
}) {
  const savings = originalTotalCents - discountedTotalCents;
  if (savings <= 0 || originalTotalCents <= 0) return null;
  // Display percent is derived from the cent delta. For typical merchant
  // configurations (whole-percent discounts on round prices) this matches
  // the stored discount_basis_points exactly.
  const percent = Math.round((savings / originalTotalCents) * 100);

  if (variant === "rows") {
    return (
      <>
        <div className="text-[11px] text-ink-muted">Subtotal</div>
        <div className="text-right text-[11px] text-ink-muted line-through tabular-nums">
          {formatDollarsCompact(originalTotalCents)}
        </div>
        <div className="text-[11px] text-emerald-700">Plan discount ({percent}%)</div>
        <div className="text-right text-[11px] text-emerald-700 tabular-nums">
          -{formatDollarsCompact(savings)}
        </div>
        <div className="text-[15px] font-bold text-ink">Total</div>
        <div className="text-right text-[15px] font-bold text-ink tabular-nums">
          {formatDollarsCompact(discountedTotalCents)}
        </div>
      </>
    );
  }

  return (
    <section className="mt-6 overflow-hidden rounded-md border border-emerald-200 bg-emerald-50">
      <div className="flex items-center gap-2 px-4 py-3 text-[13px] font-medium text-emerald-800">
        <SavingsIcon />
        Save {formatDollarsCompact(savings)} ({percent}%) with this plan
      </div>
      <dl className="grid grid-cols-2 gap-y-1 border-t border-emerald-200 bg-white px-4 py-3">
        <dt className="text-[12px] text-ink-muted">Subtotal</dt>
        <dd className="text-right text-[12px] text-ink-muted line-through tabular-nums">
          {formatDollarsCompact(originalTotalCents)}
        </dd>
        <dt className="text-[12px] text-emerald-700">Plan discount ({percent}%)</dt>
        <dd className="text-right text-[12px] text-emerald-700 tabular-nums">
          -{formatDollarsCompact(savings)}
        </dd>
        <dt className="mt-1 text-[18px] font-bold text-ink">Total</dt>
        <dd className="mt-1 text-right text-[18px] font-bold text-ink tabular-nums">
          {formatDollarsCompact(discountedTotalCents)}
        </dd>
      </dl>
    </section>
  );
}

function SavingsIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 12V8H6a2 2 0 0 1-2-2c0-1.1.9-2 2-2h12v4" />
      <path d="M4 6v12c0 1.1.9 2 2 2h14v-4" />
      <path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
    </svg>
  );
}
