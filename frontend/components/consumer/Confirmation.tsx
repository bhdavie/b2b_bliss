"use client";

import Link from "next/link";
import {
  formatDollarsCompact,
  formatScheduleDateLong,
  formatScheduleDateShort,
  type CreatePlanResponse,
  type PublicBooking,
} from "@/lib/publicApi";
import { feeFor } from "@/lib/blissFee";

export function Confirmation({
  booking,
  plan,
}: {
  booking: PublicBooking;
  plan: CreatePlanResponse;
}) {
  const firstPaymentStatus = plan.firstChargeStatus.toLowerCase();
  const firstSucceeded =
    firstPaymentStatus === "succeeded" || firstPaymentStatus === "paid";
  const hasDiscount =
    plan.originalTotalAmountCents != null
    && plan.originalTotalAmountCents > plan.totalAmountCents;
  const savings =
    hasDiscount && plan.originalTotalAmountCents != null
      ? plan.originalTotalAmountCents - plan.totalAmountCents
      : 0;
  const percent =
    hasDiscount && plan.originalTotalAmountCents != null
      ? Math.round((savings / plan.originalTotalAmountCents) * 100)
      : 0;
  const processingFeeCents = feeFor(plan.totalAmountCents);
  const displayedTotalCents = plan.totalAmountCents + processingFeeCents;

  return (
    <div>
      <div className="mt-6 flex flex-col items-center text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-lavender text-white">
          <CheckIcon />
        </div>
        <h1 className="mt-4 text-[24px] font-medium leading-tight text-ink">
          You&apos;re booked
        </h1>
        <p className="mt-1 text-[14px] text-ink-muted">
          Your plan with {booking.merchant.businessName} is set.
        </p>
      </div>

      <section className="mt-6 rounded-md bg-brand-cream/60 p-4">
        <div className="text-[14px] font-medium text-ink">
          {booking.service.name}
        </div>
        <div className="mt-0.5 text-[12px] text-ink-muted">
          {formatScheduleDateLong(booking.service.appointmentDate)}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-y-2 text-[12px]">
          {hasDiscount && plan.originalTotalAmountCents != null ? (
            <>
              <div className="text-[11px] text-ink-muted">Subtotal</div>
              <div className="text-right text-[11px] text-ink-muted line-through tabular-nums">
                {formatDollarsCompact(plan.originalTotalAmountCents)}
              </div>
              <div className="text-[11px] text-emerald-700">
                Plan discount ({percent}%)
              </div>
              <div className="text-right text-[11px] text-emerald-700 tabular-nums">
                -{formatDollarsCompact(savings)}
              </div>
            </>
          ) : null}
          <div className="text-[11px] text-ink-muted">Processing fee</div>
          <div className="text-right text-[11px] text-ink-muted tabular-nums">
            +{formatDollarsCompact(processingFeeCents)}
          </div>
          <div className="text-[15px] font-bold text-ink">Total</div>
          <div className="text-right text-[15px] font-bold text-ink tabular-nums">
            {formatDollarsCompact(displayedTotalCents)}
          </div>
          {plan.depositAmountCents > 0 ? (
            <>
              <div className="text-ink-muted">Deposit today</div>
              <div className="text-right text-ink">
                {formatDollarsCompact(plan.depositAmountCents)}
              </div>
            </>
          ) : null}
          <div className="text-ink-muted">Plan</div>
          <div className="text-right text-ink">
            {plan.numPayments}{" "}
            {plan.frequency === "biweekly" ? "bi-weekly" : "monthly"} payment
            {plan.numPayments === 1 ? "" : "s"}
          </div>
          <div className="text-ink-muted">
            {plan.depositAmountCents > 0 ? "Deposit charge" : "First payment"}
          </div>
          <div className="text-right text-ink">
            {firstSucceeded ? "Charged today" : "Processing"}
          </div>
        </div>
      </section>

      <section className="mt-6">
        <div className="text-[11px] font-medium uppercase tracking-[0.6px] text-ink-muted">
          Schedule
        </div>
        <ol className="mt-2.5 divide-y divide-brand-neutral rounded-md border border-brand-neutral bg-white">
          {plan.schedule.map((entry) => (
            <li
              key={entry.sequence}
              className={`flex items-center justify-between px-3 py-2.5 text-[13px] ${
                entry.kind === "deposit" ? "bg-brand-cream/60" : ""
              }`}
            >
              <span className="flex items-center gap-2 text-ink-muted">
                {entry.kind === "deposit" ? (
                  <span className="rounded-full bg-brand-lavender px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-white">
                    Deposit
                  </span>
                ) : null}
                <span>
                  {entry.kind === "deposit" ? "Today" : formatScheduleDateShort(entry.dueDate)}
                </span>
              </span>
              <span className="tabular-nums text-ink">
                {formatDollarsCompact(entry.amountCents)}
              </span>
            </li>
          ))}
        </ol>
      </section>

      <div className="mt-6 grid gap-2">
        <button
          type="button"
          onClick={() => window.print()}
          className="w-full rounded-md bg-brand-navy px-4 py-3 text-[14px] font-medium text-white transition-colors hover:bg-brand-navy-dark"
        >
          Save schedule as PDF
        </button>
        {plan.bookingToken ? (
          <Link
            href={`/plan/${plan.bookingToken}`}
            className="text-center text-[12px] font-medium text-brand-purple underline-offset-2 hover:underline"
          >
            Manage your plan
          </Link>
        ) : (
          <p className="text-center text-[11px] text-ink-muted">
            Manage your plan anytime at bliss.com/account
          </p>
        )}
      </div>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12l5 5L20 7" />
    </svg>
  );
}
