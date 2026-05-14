import Link from "next/link";
import { notFound } from "next/navigation";
import { PlanDetailActions } from "@/components/merchant/PlanDetailActions";
import { fetchPlanServer } from "@/lib/auth";
import type { PaymentPlanStatus } from "@/lib/api";

const STATUS_LABEL: Record<PaymentPlanStatus, string> = {
  active: "Active",
  payment_failed_in_retry: "Payment failed · retrying",
  payment_failed_exhausted: "Retries exhausted",
  balance_due_at_arrival: "Balance due at check-in",
  completed: "Completed",
  defaulted: "Defaulted",
  canceled: "Canceled",
};

const STATUS_PILL: Record<PaymentPlanStatus, string> = {
  active: "bg-emerald-100 text-emerald-700",
  payment_failed_in_retry: "bg-amber-100 text-amber-800",
  payment_failed_exhausted: "bg-red-100 text-red-700",
  balance_due_at_arrival: "bg-lavender-100 text-lavender-700",
  completed: "bg-emerald-100 text-emerald-700",
  defaulted: "bg-red-100 text-red-700",
  canceled: "bg-surface-subtle text-ink-muted",
};

export default async function PlanDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const plan = await fetchPlanServer(id);
  if (!plan) notFound();

  const paidCents = plan.schedule
    .filter((e) => e.status === "paid")
    .reduce((s, e) => s + e.amountCents, 0);
  const balance = Math.max(0, plan.totalAmountCents - paidCents);

  return (
    <>
      <header>
        <Link
          href="/dashboard"
          className="text-xs text-ink-muted hover:underline"
        >
          ← Back to dashboard
        </Link>
        <div className="mt-2 flex items-baseline justify-between gap-3">
          <h1 className="text-2xl font-medium">{plan.serviceName}</h1>
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${STATUS_PILL[plan.status]}`}
          >
            {STATUS_LABEL[plan.status]}
          </span>
        </div>
        <p className="mt-1 text-ink-muted">
          {plan.customerHint ?? "Customer info pending"} · Appointment{" "}
          {plan.appointmentDate}
        </p>
      </header>

      {plan.status === "balance_due_at_arrival" ? (
        <section className="mt-6 rounded-md border-2 border-lavender-500 bg-lavender-50 p-4">
          <div className="text-[11px] font-medium uppercase tracking-wide text-lavender-700">
            Balance due at check-in
          </div>
          <div className="mt-1 text-[24px] font-medium tabular-nums text-navy">
            {formatCents(balance)}
          </div>
          <p className="mt-1 text-xs text-ink-muted">
            Booking is still confirmed. Collect the remaining balance from the
            customer when they arrive.
          </p>
        </section>
      ) : null}

      {plan.failedInstallment ? (
        <section className="mt-6 rounded-md border border-amber-200 bg-amber-50 p-4">
          <div className="text-[11px] font-medium uppercase tracking-wide text-amber-800">
            Failed installment
          </div>
          <div className="mt-1 text-sm text-amber-900">
            Installment {plan.failedInstallment.sequence} of{" "}
            {formatCents(plan.failedInstallment.amountCents)} failed on{" "}
            {plan.failedInstallment.dueDate}. Retries attempted:{" "}
            {plan.failedInstallment.retryCount}.
          </div>
          {plan.failedInstallment.lastError ? (
            <div className="mt-1 text-xs text-amber-800 font-mono">
              {plan.failedInstallment.lastError}
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="mt-8 grid gap-4 sm:grid-cols-2">
        <div className="card p-4">
          <div className="text-xs text-ink-muted">Plan</div>
          <div className="mt-1 text-sm">
            {plan.numPayments}{" "}
            {plan.frequency === "biweekly" ? "bi-weekly" : "monthly"} installment
            {plan.numPayments === 1 ? "" : "s"}
          </div>
          {plan.depositAmountCents > 0 ? (
            <div className="mt-1 text-xs text-ink-muted">
              + {formatCents(plan.depositAmountCents)} deposit
            </div>
          ) : null}
        </div>
        <div className="card p-4">
          <div className="text-xs text-ink-muted">Total · Paid · Balance</div>
          <div className="mt-1 text-sm tabular-nums">
            {formatCents(plan.totalAmountCents)} ·{" "}
            <span className="text-emerald-700">{formatCents(paidCents)}</span> ·{" "}
            <span className={balance > 0 ? "text-ink" : "text-ink-soft"}>
              {formatCents(balance)}
            </span>
          </div>
        </div>
      </section>

      <section className="mt-6">
        <div className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">
          Schedule
        </div>
        <ol className="mt-2.5 divide-y divide-surface-border rounded-md border border-surface-border bg-white">
          {plan.schedule.map((entry) => (
            <li
              key={entry.sequence}
              className={`grid grid-cols-[auto_1fr_auto] items-center gap-3 px-3 py-2.5 text-[13px] ${
                entry.kind === "deposit" ? "bg-cream-dark/40" : ""
              }`}
            >
              <span className="text-xs text-ink-muted tabular-nums w-10">
                #{entry.sequence}
              </span>
              <span className="flex items-center gap-2 text-ink-muted">
                {entry.kind === "deposit" ? (
                  <span className="rounded-full bg-navy px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-white">
                    Deposit
                  </span>
                ) : null}
                <span>{entry.dueDate}</span>
                <StatusPill status={entry.status} />
                {entry.retryCount > 0 ? (
                  <span className="text-[10px] text-ink-soft">
                    · {entry.retryCount} retr{entry.retryCount === 1 ? "y" : "ies"}
                  </span>
                ) : null}
              </span>
              <span className="tabular-nums text-ink">
                {formatCents(entry.amountCents)}
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-8">
        <PlanDetailActions plan={plan} />
      </section>
    </>
  );
}

function StatusPill({ status }: { status: string }) {
  const cls =
    status === "paid"
      ? "bg-emerald-100 text-emerald-700"
      : status === "failed" || status === "retrying"
        ? "bg-red-100 text-red-700"
        : status === "processing"
          ? "bg-amber-100 text-amber-800"
          : "bg-surface-subtle text-ink-muted";
  return (
    <span
      className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide ${cls}`}
    >
      {status}
    </span>
  );
}

function formatCents(cents: number): string {
  if (cents % 100 === 0) return `$${(cents / 100).toLocaleString()}`;
  return (cents / 100).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
  });
}
