import Link from "next/link";
import {
  formatDollars,
  formatScheduleDateLong,
  formatScheduleDateShort,
  type AccountPlanCard,
} from "@/lib/publicApi";
import { Panel } from "@/components/portal/primitives";

/**
 * Plan card for the guest portal lists, built to the settled design (turn 6a):
 * a bordered 20px panel, merchant name at 30px over the service and date, a
 * status pill top-right, a rule, then a single meta line of figures with the
 * "View plan" pill beside it.
 */
/**
 * Which list the guest is looking at. Travels to /plan/[token] as `?from=`, so
 * the plan screen can light the tab they left and send them back to it.
 */
export type PlanOrigin = "home" | "history";

export function PlanCard({
  plan,
  from,
}: {
  plan: AccountPlanCard;
  from?: PlanOrigin;
}) {
  const href = from
    ? `/plan/${plan.bookingToken}?from=${from}`
    : `/plan/${plan.bookingToken}`;
  const canceled = plan.status === "canceled";
  const complete = plan.complete;
  const dateRange = plan.checkoutDate
    ? `${formatScheduleDateShort(plan.appointmentDate)} to ${formatScheduleDateShort(plan.checkoutDate)}`
    : formatScheduleDateLong(plan.appointmentDate);

  return (
    <Panel className="px-10 pb-[30px] pt-9">
      <div className="flex items-start justify-between gap-8">
        <div className="flex min-w-0 flex-col gap-2.5">
          <div className="text-[30px] font-medium leading-[1.1] tracking-[-0.025em] text-ink-900">
            {plan.merchantBusinessName}
          </div>
          <div className="text-lg text-ink-500">{plan.serviceName}</div>
          <div className="text-lg text-ink-500">{dateRange}</div>
        </div>
        <div className="flex flex-none items-center gap-2">
          {plan.refunded ? <Pill tone="accent">Refunded</Pill> : null}
          <Pill tone={canceled ? "neutral" : complete ? "accent" : "accent"}>
            {canceled ? "Cancelled" : complete ? "Completed" : "Active"}
          </Pill>
        </div>
      </div>

      <div className="mb-6 mt-[30px] h-px bg-sand-200" />

      <div className="flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-center sm:gap-8">
        <div className="flex flex-wrap items-baseline text-[17px] text-ink-500">
          <span>
            Plan total{" "}
            <Figure>{formatDollars(plan.totalWithFeeCents)}</Figure>
          </span>
          <Dot />
          <span>
            Paid to date <Figure>{formatDollars(plan.paidCents)}</Figure>
          </span>
          <Dot />
          <span>
            Remaining <Figure>{formatDollars(plan.remainingCents)}</Figure>
          </span>
          <Dot />
          <span>
            {capitalize(plan.frequency)} · {plan.numPayments} installments
          </span>
        </div>
        <Link
          href={href}
          className="flex-none rounded-full border border-sand-500 px-[26px] py-[13px] text-base font-medium tracking-[-0.01em] text-brand-violet no-underline transition-colors hover:bg-sand-50 hover:no-underline"
        >
          View plan
        </Link>
      </div>
    </Panel>
  );
}

function Figure({ children }: { children: React.ReactNode }) {
  return <span className="font-medium text-ink-900">{children}</span>;
}

function Dot() {
  return <span className="px-3 text-sand-600">·</span>;
}

function Pill({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "accent" | "neutral";
}) {
  return (
    <span
      className={`flex-none rounded-full px-4 py-2 text-[13px] font-medium uppercase tracking-[0.06em] ${
        tone === "accent"
          ? "bg-brand-violet-tint text-brand-violet"
          : "bg-[#F4F2EF] text-ink-500"
      }`}
    >
      {children}
    </span>
  );
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
