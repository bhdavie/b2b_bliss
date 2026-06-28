import Link from "next/link";
import {
  formatDollars,
  formatScheduleDateLong,
  formatScheduleDateShort,
  type AccountPlanCard,
} from "@/lib/publicApi";

// Bliss design language: Inter (font-body, inherited) headings, square corners,
// navy / purple / lavender palette. The `muted` variant de-emphasizes past
// plans on the History screen.
export function PlanCard({
  plan,
  muted = false,
}: {
  plan: AccountPlanCard;
  muted?: boolean;
}) {
  const canceled = plan.status === "canceled";
  const complete = plan.complete;
  const badgeStatus = canceled ? "canceled" : complete ? "completed" : "active";
  const dateRange = plan.checkoutDate
    ? `${formatScheduleDateShort(plan.appointmentDate)} to ${formatScheduleDateShort(plan.checkoutDate)}`
    : formatScheduleDateLong(plan.appointmentDate);

  return (
    <Link
      href={`/plan/${plan.bookingToken}`}
      className={`block rounded-none border p-6 transition ${
        muted
          ? "border-brand-neutral bg-brand-neutral/10 hover:bg-brand-neutral/20"
          : "border-brand-neutral bg-white hover:border-brand-purple/40"
      }`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2
          className={`text-2xl font-bold ${muted ? "text-ink-muted" : "text-brand-navy"}`}
        >
          {plan.merchantBusinessName}
        </h2>
        <StatusBadge status={badgeStatus} />
      </div>

      <p className="mt-1 text-sm text-ink-muted">{plan.serviceName}</p>
      <p className="text-xs text-ink-muted">
        {dateRange}
      </p>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Metric label="Plan total" value={formatDollars(plan.totalWithFeeCents)} />
        <Metric label="Paid to date" value={formatDollars(plan.paidCents)} />
        <Metric
          label={complete || canceled ? "Remaining" : "Next payment"}
          value={
            complete
              ? formatDollars(0)
              : canceled
                ? formatDollars(plan.remainingCents)
                : plan.nextDueDate && plan.nextDueAmountCents != null
                  ? `${formatDollars(plan.nextDueAmountCents)} · ${formatScheduleDateShort(plan.nextDueDate)}`
                  : formatDollars(plan.remainingCents)
          }
        />
      </div>

      <div className="mt-4 flex items-center justify-between text-xs text-ink-muted">
        <span>
          {capitalize(plan.frequency)} · {plan.numPayments} installments
        </span>
        <span className="font-medium text-brand-purple">View plan</span>
      </div>
    </Link>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-none border border-brand-lavender bg-white px-3 py-2">
      <div className="text-[10px] text-ink-muted">
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold tabular-nums text-brand-navy">
        {value}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    active: "border border-brand-lavender bg-white text-brand-purple",
    completed: "bg-brand-lavender text-white",
    canceled: "bg-brand-neutral text-ink-muted",
  };
  const cls = map[status] ?? "border border-brand-lavender bg-white text-brand-purple";
  const label = status === "canceled" ? "cancelled" : status.replace(/_/g, " ");
  return (
    <span
      className={`inline-flex items-center rounded-none px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${cls}`}
    >
      {label}
    </span>
  );
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
