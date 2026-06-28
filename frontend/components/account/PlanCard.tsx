import Link from "next/link";
import {
  formatDollars,
  formatScheduleDateLong,
  formatScheduleDateShort,
  type AccountPlanCard,
} from "@/lib/publicApi";

export function PlanCard({ plan }: { plan: AccountPlanCard }) {
  const complete = plan.status === "completed" || plan.scheduledCount === 0;
  const totalInstallments = plan.numPayments; // installments excluding deposit
  // The total row count includes the deposit; for "X of Y paid" framing we
  // want to convey progress including the deposit.
  const totalRows = totalInstallments + 1;
  const dateRange = plan.checkoutDate
    ? `${formatScheduleDateShort(plan.appointmentDate)} – ${formatScheduleDateShort(plan.checkoutDate)}`
    : formatScheduleDateLong(plan.appointmentDate);

  return (
    <Link
      href={`/plan/${plan.bookingToken}`}
      className="block rounded-lg border border-brand-neutral bg-white/70 p-6 shadow-sm backdrop-blur-sm transition hover:bg-white"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-xl text-brand-navy">
          {plan.merchantBusinessName}
        </h2>
        {complete ? (
          <span className="inline-flex items-center rounded-full bg-brand-lavender px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-white">
            Plan complete
          </span>
        ) : (
          <span className="text-xs uppercase tracking-[0.18em] text-ink-muted">
            {plan.paidCount} of {totalRows} paid
          </span>
        )}
      </div>

      <p className="mt-1 text-sm text-ink-muted">{plan.serviceName}</p>
      <p className="text-xs uppercase tracking-[0.12em] text-ink-muted">
        {dateRange}
      </p>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded border border-brand-lavender bg-white px-3 py-2">
          <div className="text-[10px] uppercase tracking-[0.18em] text-ink-muted">
            Plan total
          </div>
          <div className="mt-1 font-display text-lg text-brand-navy">
            {formatDollars(plan.totalWithFeeCents)}
          </div>
        </div>
        <div className="rounded border border-brand-lavender bg-white px-3 py-2">
          <div className="text-[10px] uppercase tracking-[0.18em] text-ink-muted">
            {complete ? "Status" : "Next payment"}
          </div>
          <div className="mt-1 font-display text-lg text-brand-navy">
            {complete
              ? "All paid"
              : plan.nextDueDate && plan.nextDueAmountCents != null
              ? `${formatDollars(plan.nextDueAmountCents)} · ${formatScheduleDateShort(plan.nextDueDate)}`
              : "—"}
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between text-xs text-ink-muted">
        <span>{capitalize(plan.frequency)} · {plan.numPayments} installments</span>
        <span className="font-medium text-brand-purple">View plan →</span>
      </div>
    </Link>
  );
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
