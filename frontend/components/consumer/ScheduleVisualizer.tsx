"use client";

import { useState } from "react";
import {
  formatDollarsCompact,
  formatScheduleDateLong,
  type PublicPlanOption,
} from "@/lib/publicApi";

type Row = {
  label: string;
  amount: number;
};

/**
 * Condensed dated schedule (funnel treatment): the first payment is shown, the
 * rest sit behind a "see all" expander instead of a flat pill row.
 *
 * Amounts are passed in pre-redistributed: `todayCents` from
 * deriveDisplayAmounts, `perPaymentCents`/`finalPaymentCents` from
 * distributeInstallments. The component itself doesn't know about the
 * processing fee; it just renders what it's given.
 */
export function ScheduleVisualizer({
  option,
  todayCents,
  perPaymentCents,
  finalPaymentCents,
}: {
  option: PublicPlanOption;
  todayCents: number;
  perPaymentCents: number;
  finalPaymentCents: number;
}) {
  const [expanded, setExpanded] = useState(false);

  const installmentRows: Row[] = option.dueDates.map((d, i) => {
    const isFinal = i === option.dueDates.length - 1;
    return {
      label: formatScheduleDateLong(d),
      amount: isFinal ? finalPaymentCents : perPaymentCents,
    };
  });

  const rows: Row[] =
    todayCents > 0
      ? [{ label: "Today", amount: todayCents }, ...installmentRows]
      : installmentRows;

  const visible = expanded ? rows : rows.slice(0, 1);

  return (
    <section className="mt-6">
      <SectionLabel>Your schedule</SectionLabel>
      <div className="mt-2 space-y-1.5" role="list" aria-label="Payment schedule">
        {visible.map((r, i) => (
          <div
            key={`${r.label}-${i}`}
            role="listitem"
            className="flex items-center justify-between rounded-none bg-brand-lavender/20 px-3 py-2 text-sm"
          >
            <span className="text-brand-navy/80">{r.label}</span>
            <span className="font-medium tabular-nums text-brand-navy">
              {formatDollarsCompact(r.amount)}
            </span>
          </div>
        ))}
      </div>
      {rows.length > 1 ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="mt-2 text-xs font-medium text-brand-purple hover:underline"
        >
          {expanded ? "Hide schedule" : `See all ${rows.length} payments`}
        </button>
      ) : null}
    </section>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-medium uppercase tracking-[0.6px] text-brand-navy/60">
      {children}
    </div>
  );
}
