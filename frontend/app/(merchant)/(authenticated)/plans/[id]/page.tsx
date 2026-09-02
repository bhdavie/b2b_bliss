import Link from "next/link";
import { notFound } from "next/navigation";
import { PlanDetailActions } from "@/components/merchant/PlanDetailActions";
import { Panel, RecordTitle, SectionHeading } from "@/components/ui/primitives";
import { fetchPlanServer } from "@/lib/auth";
import type { PaymentPlanStatus } from "@/lib/api";

const STATUS_LABEL: Record<PaymentPlanStatus, string> = {
  pending_card: "Awaiting card",
  active: "Active",
  payment_failed_in_retry: "Payment failed · retrying",
  payment_failed_exhausted: "Retries exhausted",
  balance_due: "Balance due at check-in",
  refund_due: "Refund due",
  completed: "Completed",
  defaulted: "Defaulted",
  canceled: "Canceled",
};

const STATUS_PILL: Record<PaymentPlanStatus, string> = {
  pending_card: "bg-brand-cream/60 text-ink-500",
  active: "bg-emerald-100 text-emerald-700",
  payment_failed_in_retry: "bg-amber-100 text-amber-800",
  payment_failed_exhausted: "bg-red-100 text-red-700",
  balance_due: "bg-brand-lavender text-white",
  refund_due: "bg-amber-100 text-amber-800",
  completed: "bg-emerald-100 text-emerald-700",
  defaulted: "bg-red-100 text-red-700",
  canceled: "bg-brand-cream/60 text-ink-500",
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

  // NOTE: nothing in the app links here — no sidebar item, no row, no button.
  // Brought onto the rule anyway rather than left as the one screen that
  // contradicts it, because an unlinked route is exactly the one that quietly
  // drifts. Its head, its two state banners and its schedule label were all
  // loose on the sand ground.
  return (
    <div className="flex flex-col gap-3">
      <Panel variant="filled" className="p-5">
        <div className="flex flex-col border-b border-sand-100 pb-5">
          <Link
            href="/home"
            className="mb-4 self-start text-[13px] text-brand-violet no-underline hover:underline"
          >
            ← Back to overview
          </Link>
          {/* Service name on SectionHeading, matching /bookings/[id] and the
              property name on /plan/[token]. It was 22px medium, the last of
              the two-treatments-for-one-thing split across the detail pages. */}
          <div className="flex items-baseline justify-between gap-3">
            <RecordTitle className="mb-2">
              {plan.serviceName}
            </RecordTitle>
            <span
              className={`inline-flex flex-none items-center rounded-full px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${STATUS_PILL[plan.status]}`}
            >
              {STATUS_LABEL[plan.status]}
            </span>
          </div>
          <div className="text-[14px] text-ink-500">
            {plan.customerHint ?? "Customer info pending"} · Appointment{" "}
            {plan.appointmentDate}
          </div>
        </div>

        <div className="grid gap-4 pt-6 sm:grid-cols-2">
          <div>
            <SectionHeading className="mb-4">Plan</SectionHeading>
            <div className="text-[14px] text-ink-900">
              {plan.numPayments}{" "}
              {plan.frequency === "biweekly" ? "bi-weekly" : "monthly"}{" "}
              installment{plan.numPayments === 1 ? "" : "s"}
            </div>
            {plan.depositAmountCents > 0 ? (
              <div className="mt-1 text-[13px] text-ink-500">
                + {formatCents(plan.depositAmountCents)} deposit
              </div>
            ) : null}
          </div>
          <div>
            <SectionHeading className="mb-4">Total · Paid · Balance</SectionHeading>
            <div className="text-[14px] tabular-nums text-ink-900">
              {formatCents(plan.totalAmountCents)} ·{" "}
              <span className="text-emerald-700">{formatCents(paidCents)}</span> ·{" "}
              <span className={balance > 0 ? "text-ink-900" : "text-ink-500"}>
                {formatCents(balance)}
              </span>
            </div>
          </div>
        </div>
      </Panel>

      {plan.status === "balance_due" ? (
        <Panel variant="filled" className="p-5">
          <SectionHeading className="mb-4">
            Balance due at check-in
          </SectionHeading>
          <div className="text-[24px] font-medium tabular-nums text-ink-900">
            {formatCents(balance)}
          </div>
          <p className="mt-1.5 text-[14px] text-ink-500">
            Booking is still confirmed. Collect the remaining balance from the
            customer when they arrive.
          </p>
        </Panel>
      ) : null}

      {plan.failedInstallment ? (
        <Panel variant="filled" className="p-5">
          <SectionHeading className="mb-4">Failed installment</SectionHeading>
          <div className="text-[14px] text-ink-900">
            Installment {plan.failedInstallment.sequence} of{" "}
            {formatCents(plan.failedInstallment.amountCents)} failed on{" "}
            {plan.failedInstallment.dueDate}. Retries attempted:{" "}
            {plan.failedInstallment.retryCount}.
          </div>
          {plan.failedInstallment.lastError ? (
            <div className="mt-1.5 font-mono text-[13px] text-ink-500">
              {plan.failedInstallment.lastError}
            </div>
          ) : null}
        </Panel>
      ) : null}

      <Panel variant="filled" className="p-5">
        <SectionHeading className="mb-4">Schedule</SectionHeading>
        <ol className="divide-y divide-sand-100">
          {plan.schedule.map((entry) => (
            <li
              key={entry.sequence}
              className="grid grid-cols-[auto_1fr_auto] items-center gap-3 py-3 text-[13px]"
            >
              <span className="w-10 tabular-nums text-[13px] text-ink-500">
                #{entry.sequence}
              </span>
              <span className="flex flex-wrap items-center gap-2 text-ink-900">
                {entry.kind === "deposit" ? (
                  <span className="rounded-full bg-brand-violet-tint px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.06em] text-brand-violet">
                    Deposit
                  </span>
                ) : null}
                <span>{entry.dueDate}</span>
                <StatusPill status={entry.status} />
                {entry.retryCount > 0 ? (
                  <span className="text-[12px] text-ink-500">
                    · {entry.retryCount} retr{entry.retryCount === 1 ? "y" : "ies"}
                  </span>
                ) : null}
              </span>
              <span className="tabular-nums text-ink-900">
                {formatCents(entry.amountCents)}
              </span>
            </li>
          ))}
        </ol>
      </Panel>

      <PlanDetailActions plan={plan} />
    </div>
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
          : "bg-brand-cream/60 text-ink-500";
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
