import Link from "next/link";
import {
  formatDollars,
  formatScheduleDateLong,
  formatScheduleDateShort,
  type AccountPlanCard,
} from "@/lib/publicApi";

/**
 * One plan, as a row inside the PlansList card.
 *
 * The content is unchanged from when this was a card of its own — property name
 * at 30px over the service and date, status pill top-right, a rule, then the
 * meta line of figures with the "View plan" pill beside it. Only the container
 * changed: it was a filled Panel sitting on the page ground next to its
 * siblings, and it is now a hairline-separated row inside the single card that
 * holds the whole list. Same treatment the /home "Recent bookings" rows and the
 * /bookings table rows take.
 */
/**
 * Which list the guest is looking at. Travels to /plan/[token] as `?from=`, so
 * the plan screen can light the tab they left and send them back to it.
 */
export type PlanOrigin = "home" | "history";

export function PlanRow({
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
    <div className="border-b border-sand-100 py-4 first:pt-0 last:border-b-0 last:pb-0">
      <div className="flex items-start justify-between gap-8">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="text-[14px] text-ink-900">
            {plan.merchantBusinessName}
          </div>
          <div className="text-[14px] text-ink-500">{plan.serviceName}</div>
          <div className="text-[14px] text-ink-500">{dateRange}</div>
        </div>
        <div className="flex flex-none items-center gap-2">
          {plan.refunded ? <Pill tone="accent">Refunded</Pill> : null}
          <Pill tone={canceled ? "neutral" : complete ? "accent" : "accent"}>
            {canceled ? "Cancelled" : complete ? "Completed" : "Active"}
          </Pill>
        </div>
      </div>

      <div className="my-3 h-px bg-sand-200" />

      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center sm:gap-6">
        <div className="flex flex-wrap items-baseline text-[14px] text-ink-500">
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
          className="flex-none rounded-full border border-sand-500 px-[26px] py-[13px] text-[14px] tracking-[-0.01em] text-brand-violet no-underline transition-colors hover:bg-sand-100 hover:no-underline"
        >
          View plan
        </Link>
      </div>
    </div>
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
          : "bg-sand-100 text-ink-500"
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
