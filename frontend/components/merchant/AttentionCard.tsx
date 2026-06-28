import Link from "next/link";
import type { PaymentPlanStatus, PlanDetail } from "@/lib/api";

const STATUS_LABEL: Record<PaymentPlanStatus, string> = {
  active: "Active",
  payment_failed_in_retry: "Payment failed · retrying",
  payment_failed_exhausted: "Retries exhausted",
  balance_due: "Balance due at check-in",
  completed: "Completed",
  defaulted: "Defaulted",
  canceled: "Canceled",
};

const STATUS_PILL: Record<PaymentPlanStatus, string> = {
  active: "bg-emerald-100 text-emerald-700",
  payment_failed_in_retry: "bg-amber-100 text-amber-800",
  payment_failed_exhausted: "bg-red-100 text-red-700",
  balance_due: "bg-brand-lavender text-white",
  completed: "bg-emerald-100 text-emerald-700",
  defaulted: "bg-red-100 text-red-700",
  canceled: "bg-brand-cream/60 text-ink-muted",
};

export function AttentionCard({ plans }: { plans: PlanDetail[] }) {
  if (plans.length === 0) {
    return (
      <div className="card p-5">
        <div className="text-sm font-medium">Plans needing attention</div>
        <p className="mt-1 text-xs text-ink-muted">
          Nothing here. Every active plan is in good standing.
        </p>
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      <div className="border-b border-brand-neutral bg-brand-cream/60 px-4 py-2.5">
        <div className="flex items-baseline justify-between">
          <div className="text-sm font-medium">Plans needing attention</div>
          <div className="text-xs text-ink-muted">{plans.length}</div>
        </div>
      </div>
      <ul className="divide-y divide-brand-neutral">
        {plans.map((plan) => (
          <li key={plan.id}>
            <Link
              href={`/plans/${plan.id}`}
              className="grid gap-3 px-4 py-3 hover:bg-brand-cream/40 sm:grid-cols-[1fr_auto] sm:items-center"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-ink">
                  {plan.serviceName}
                </div>
                <div className="mt-0.5 text-xs text-ink-muted">
                  {plan.customerHint ?? "Customer info pending"}
                </div>
                {plan.status === "balance_due" ? (
                  <div className="mt-1 text-xs font-medium text-brand-purple">
                    Balance due at check-in:{" "}
                    {formatCents(balanceDue(plan))}
                  </div>
                ) : plan.failedInstallment ? (
                  <div className="mt-1 text-xs text-ink-muted">
                    Failed installment {plan.failedInstallment.sequence}:{" "}
                    {formatCents(plan.failedInstallment.amountCents)} ·{" "}
                    {plan.failedInstallment.retryCount} retr
                    {plan.failedInstallment.retryCount === 1 ? "y" : "ies"}
                  </div>
                ) : null}
              </div>
              <span
                className={`justify-self-start sm:justify-self-end inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                  STATUS_PILL[plan.status]
                }`}
              >
                {STATUS_LABEL[plan.status]}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function balanceDue(plan: PlanDetail): number {
  const paid = plan.schedule
    .filter((e) => e.status === "paid")
    .reduce((sum, e) => sum + e.amountCents, 0);
  return Math.max(0, plan.totalAmountCents - paid);
}

function formatCents(cents: number): string {
  if (cents % 100 === 0) return `$${(cents / 100).toLocaleString()}`;
  return (cents / 100).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
  });
}
