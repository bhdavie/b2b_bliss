import Link from "next/link";
import {
  formatDollars,
  formatScheduleDateLong,
  formatScheduleDateShort,
  type AccountPlanCard,
} from "@/lib/publicApi";

/**
 * Which list the guest is looking at. Travels to /plan/[token] as `?from=`, so
 * the plan screen can light the tab they left and send them back to it.
 */
export type PlanOrigin = "home" | "history";

/**
 * Guest-facing status labels.
 *
 * This used to be `canceled ? "Cancelled" : complete ? "Completed" : "Active"`,
 * which collapsed SIX distinct statuses into "Active": pending_card,
 * payment_failed_in_retry, payment_failed_exhausted, balance_due, refund_due
 * and defaulted. A plan still waiting for a card, and a plan whose retries had
 * all failed, both told the guest everything was fine.
 *
 * "attention" is the loud treatment, matching the near-black Late badge on the
 * merchant bookings table. Anything the guest has to act on takes it.
 */
type PillTone = "accent" | "neutral" | "attention";

const STATUS_PILL: Record<string, { label: string; tone: PillTone }> = {
  pending_card: { label: "Finish setup", tone: "attention" },
  active: { label: "Active", tone: "accent" },
  payment_failed_in_retry: { label: "Payment failed", tone: "attention" },
  payment_failed_exhausted: { label: "Payment failed", tone: "attention" },
  balance_due: { label: "Balance due", tone: "attention" },
  refund_due: { label: "Refund due", tone: "accent" },
  completed: { label: "Completed", tone: "accent" },
  defaulted: { label: "Defaulted", tone: "attention" },
  canceled: { label: "Cancelled", tone: "neutral" },
};

function statusPill(plan: AccountPlanCard): { label: string; tone: PillTone } {
  // `complete` is the backend's own as-of-today derivation, so it outranks the
  // stored status; `canceled` outranks everything else. Only then does the
  // stored status decide, and an unrecognised one falls back to humanising
  // itself rather than silently reading as "Active".
  if (plan.status === "canceled") return STATUS_PILL.canceled!;
  if (plan.complete) return STATUS_PILL.completed!;
  return (
    STATUS_PILL[plan.status] ?? {
      label: plan.status.replace(/_/g, " "),
      tone: "neutral",
    }
  );
}

/**
 * One plan, as its own card inside the PlansList card.
 *
 * The property name is the title and the stay, room and rate share the muted
 * line under it. An earlier pass had the stay leading, because on an account
 * held entirely at one property the dates were the only field that varied;
 * once the account spans several properties the name is what a guest
 * recognises first, and the date still does the distinguishing from line two.
 *
 * Next payment has a column of its own. It was not on the row at all before,
 * despite being both unique per plan and the thing a guest most often opens
 * the page to check.
 */
export function PlanRow({
  plan,
  from,
  showNextPayment = true,
}: {
  plan: AccountPlanCard;
  from?: PlanOrigin;
  /**
   * History passes false: those plans are paid off or cancelled, so they have
   * no next payment and the column would be a row of dashes.
   */
  showNextPayment?: boolean;
}) {
  const href = from
    ? `/plan/${plan.bookingToken}?from=${from}`
    : `/plan/${plan.bookingToken}`;
  const stay = plan.checkoutDate
    ? `${formatScheduleDateShort(plan.appointmentDate)} to ${formatScheduleDateShort(plan.checkoutDate)}`
    : formatScheduleDateLong(plan.appointmentDate);
  const pill = statusPill(plan);
  const hasNext = plan.nextDueDate != null && plan.nextDueAmountCents != null;

  return (
    // The whole card is the link, not just the View plan button: a card that
    // darkens under the cursor has to actually be clickable. That means there
    // can be exactly one <a> here, so the View plan affordance below is a span
    // styled as a pill rather than a second (illegal, nested) link.
    //
    // White fill, sand-500 edge. sand-200 against a white parent was a 1.25:1
    // hairline that the parent's own identical hairline then competed with;
    // sand-500 is 1.67:1 and is already this app's visible-edge token. Hover
    // takes the border one step further to sand-600 and shifts the fill to
    // sand-50, matching how the merchant bookings rows respond.
    <Link
      href={href}
      className="group block rounded-card border border-sand-500 bg-white p-4 no-underline transition-colors hover:border-sand-600 hover:bg-sand-50 hover:no-underline focus-visible:outline-none focus-visible:shadow-focus-ring"
    >
      {/* Fixed widths on the two right columns, not auto: the status pill
          varies in width from "Active" to "Finish setup", and on auto columns
          that shunted the next-payment column left and right by ~65px from row
          to row, so nothing lined up down the list. */}
      <div
        className={`grid gap-4 sm:items-start sm:gap-6 ${
          showNextPayment
            ? "sm:grid-cols-[minmax(0,1fr)_170px_160px]"
            : "sm:grid-cols-[minmax(0,1fr)_160px]"
        }`}
      >
        {/* Property name is the title now. The stay led before, on the
            reasoning that dates were the only field that varied; with several
            properties on the account the name is what a guest recognises, and
            the date has moved down to do the distinguishing from there. */}
        <div className="flex min-w-0 flex-col gap-1">
          <div className="truncate text-[18px] font-semibold text-ink-900">
            {plan.merchantBusinessName}
          </div>
          <div className="truncate text-[14px] text-ink-500">
            {stay} · {plan.serviceName}
          </div>
        </div>

        {showNextPayment ? (
          <div className="flex flex-col gap-1">
            <div className="text-[12px] uppercase tracking-[0.08em] text-ink-500">
              Next payment
            </div>
            {hasNext ? (
              <div className="text-[14px] text-ink-900">
                {formatDollars(plan.nextDueAmountCents ?? 0)}
                <span className="text-ink-500">
                  {" "}
                  on {formatScheduleDateShort(plan.nextDueDate ?? "")}
                </span>
              </div>
            ) : (
              <div className="text-[14px] text-ink-500">None scheduled</div>
            )}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-start gap-2 sm:justify-end">
          {plan.refunded ? <Pill tone="accent">Refunded</Pill> : null}
          <Pill tone={pill.tone}>{pill.label}</Pill>
        </div>
      </div>

      <div className="my-3 h-px bg-sand-200" />

      {/* Two values, not five. Plan total and paid-to-date are gone: the same
          five figures repeated down every row was the bulk of the grey noise,
          and remaining plus the schedule already answers what the guest owes.
          Both survivors are on the plan screen in full. */}
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center sm:gap-6">
        <div className="flex flex-wrap items-baseline text-[14px] text-ink-500">
          <span>
            Remaining <Figure>{formatDollars(plan.remainingCents)}</Figure>
          </span>
          <Dot />
          <span>
            {capitalize(plan.frequency)} · {plan.numPayments} installments
          </span>
        </div>
        <span className="flex-none rounded-full border border-sand-500 px-[26px] py-[13px] text-[14px] tracking-[-0.01em] text-brand-violet transition-colors group-hover:border-brand-violet">
          View plan
        </span>
      </div>
    </Link>
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
  tone: PillTone;
}) {
  const cls =
    tone === "accent"
      ? "bg-brand-violet-tint text-brand-violet"
      : tone === "attention"
        ? "bg-ink-900 text-white"
        : "bg-sand-100 text-ink-500";
  return (
    <span
      className={`flex-none whitespace-nowrap rounded-full px-4 py-2 text-[13px] font-medium uppercase tracking-[0.06em] ${cls}`}
    >
      {children}
    </span>
  );
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
