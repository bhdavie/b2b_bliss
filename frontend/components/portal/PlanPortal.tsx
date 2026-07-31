"use client";

import { useState } from "react";
import Link from "next/link";
import { BlissWordmark } from "@/components/BlissWordmark";
import {
  fetchPlanPortal,
  formatDollars,
  formatScheduleDateLong,
  type PublicPlanPortal,
} from "@/lib/publicApi";
import { PayEarlyButton } from "./PayEarlyButton";
import { UpdateCardSection } from "./UpdateCardSection";
import { CancelPlanSection } from "./CancelPlanSection";

export function PlanPortal({
  token,
  initial,
  backHref = "/account",
}: {
  token: string;
  initial: PublicPlanPortal;
  /**
   * Where "Back to your plans" points. Pass `null` to omit the link entirely,
   * which /account does in the single-plan case: there the plan IS the plans
   * view, so a back-link would point at the page you are already on.
   */
  backHref?: string | null;
}) {
  const [portal, setPortal] = useState<PublicPlanPortal>(initial);

  async function refresh() {
    const next = await fetchPlanPortal(token);
    if (next) setPortal(next);
  }

  const totalDue = portal.plan.totalAmountCents + portal.processingFeeCents;
  const hasDiscount =
    portal.booking.originalTotalAmountCents != null
    && portal.booking.originalTotalAmountCents > portal.plan.totalAmountCents;
  const savings =
    hasDiscount && portal.booking.originalTotalAmountCents != null
      ? portal.booking.originalTotalAmountCents - portal.plan.totalAmountCents
      : 0;
  const savingsPercent =
    hasDiscount && portal.booking.originalTotalAmountCents != null
      ? Math.round((savings / portal.booking.originalTotalAmountCents) * 100)
      : 0;
  // As-of-today derivation comes from the backend (single source of truth).
  const planComplete = portal.complete;
  const nextDueAmount = portal.nextDueAmountCents;
  const nextDueDate = portal.nextDueDate;
  const hasUpcoming =
    !planComplete && nextDueAmount != null && nextDueDate != null;
  const displayStatus = planComplete ? "completed" : portal.plan.status;
  // Hawthorn gets the on-brand regional close-out; other merchants get a
  // neutral fallback so the celebration UI works for any completed plan.
  const enjoyCopy =
    portal.merchant.slug === "hawthorn-camden"
      ? "Enjoy Maine."
      : "Enjoy your stay.";

  return (
    <div className="space-y-6">
      <div>
        {backHref ? (
          <Link
            href={backHref}
            className="text-sm font-medium text-brand-purple no-underline hover:underline"
          >
            Back to your plans
          </Link>
        ) : null}
        <h1
          className={`${backHref ? "mt-4 " : ""}text-4xl font-bold tracking-tight text-brand-navy`}
        >
          {portal.merchant.businessName}
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          {portal.booking.serviceName}
        </p>
      </div>

      <div className="space-y-6">
        {portal.plan.refundedAt ? (
          <section className="flex items-center gap-3 rounded-none border border-brand-purple/40 bg-brand-lavender/15 px-4 py-3">
            <span className="inline-flex items-center bg-brand-purple px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-white">
              Refunded
            </span>
            <span className="text-sm text-brand-navy">
              {formatDollars(portal.plan.refundAmountCents ?? 0)} has been refunded to you.
            </span>
          </section>
        ) : null}

        {planComplete ? (
          <section className="text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-none bg-brand-lavender text-white">
              <CheckIcon />
            </div>
            <h1 className="mt-4 font-bold text-4xl text-brand-navy">
              You&apos;re all set
            </h1>
            <p className="mt-2 text-sm text-ink-muted">
              Your stay at {portal.merchant.businessName} is fully paid.{" "}
              {enjoyCopy}
            </p>
          </section>
        ) : null}

        <Card title="Schedule">
          <ScheduleTimeline schedule={portal.schedule} />
        </Card>

        {hasUpcoming ? (
          <Card title="Next payment">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
              <div>
                <div className="font-semibold text-3xl text-brand-navy">
                  {formatDollars(nextDueAmount ?? 0)}
                </div>
                <div className="mt-1 text-xs text-ink-muted">
                  Due {formatScheduleDateLong(nextDueDate ?? "")}
                </div>
              </div>
              <PayEarlyButton
                token={token}
                amount={nextDueAmount ?? 0}
                onPaid={refresh}
              />
            </div>
          </Card>
        ) : null}

        {!planComplete ? (
          <Card title="Payment method">
            {portal.card ? (
              <div className="flex items-center justify-between gap-4 text-sm">
                <div>
                  <div className="font-semibold text-lg text-brand-navy">
                    {brandLabel(portal.card.brand)} •••• {portal.card.lastFour}
                  </div>
                  <div className="mt-1 text-xs text-ink-muted">
                    Expires {String(portal.card.expMonth).padStart(2, "0")}/{String(portal.card.expYear).slice(-2)}
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-ink-muted">No card on file.</p>
            )}
            <div className="mt-4">
              <UpdateCardSection
                token={token}
                stripeConfigured={portal.stripe.configured}
                stripePublishableKey={portal.stripe.publishableKey}
                onReplaced={refresh}
              />
            </div>
          </Card>
        ) : null}

        <Card title="Booking">
          {portal.booking.customerNameHint ? (
            <Row label="Guest" value={portal.booking.customerNameHint} />
          ) : null}
          <Row label="Stay" value={portal.booking.serviceName} />
          <Row
            label="Check-in"
            value={formatScheduleDateLong(portal.booking.appointmentDate)}
          />
          {portal.booking.checkoutDate ? (
            <Row
              label="Check-out"
              value={formatScheduleDateLong(portal.booking.checkoutDate)}
            />
          ) : null}
          <Row
            label="Plan status"
            value={
              <span
                className={
                  planComplete
                    ? "rounded-none bg-brand-lavender px-3 py-0.5 text-xs font-semibold uppercase tracking-[0.12em] text-white"
                    : displayStatus === "active"
                    ? "rounded-none border border-brand-lavender bg-white px-3 py-0.5 text-xs font-medium uppercase tracking-[0.12em] text-brand-purple"
                    : "rounded-none bg-amber-100 px-3 py-0.5 text-xs font-medium uppercase tracking-[0.12em] text-amber-900"
                }
              >
                {displayStatus.replace(/_/g, " ")}
              </span>
            }
          />
        </Card>

        {!planComplete ? (
          <Card title="Plan summary">
            <div className="space-y-2 text-sm text-ink">
              {hasDiscount && portal.booking.originalTotalAmountCents != null ? (
                <>
                  <Line label="Subtotal" value={formatDollars(portal.booking.originalTotalAmountCents)} />
                  <Line
                    label={`Plan discount (${savingsPercent}%)`}
                    value={`−${formatDollars(savings)}`}
                    emphasis="forest"
                  />
                </>
              ) : (
                <Line label="Subtotal" value={formatDollars(portal.plan.totalAmountCents)} />
              )}
              <Line
                label="Processing fee"
                value={`+${formatDollars(portal.processingFeeCents)}`}
              />
            </div>
            <div className="mt-3 flex items-baseline justify-between border-t border-brand-neutral pt-3">
              <span className="font-semibold text-lg text-brand-navy">Total</span>
              <span className="font-semibold text-2xl font-semibold text-brand-navy">
                {formatDollars(totalDue)}
              </span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-none bg-brand-purple px-3 py-2">
                <div className="text-[11px] text-white/80">
                  Paid to date
                </div>
                <div className="mt-1 font-semibold text-lg text-white">
                  {formatDollars(portal.paidCents)}
                </div>
              </div>
              <div className="rounded-none border-2 border-brand-lavender bg-white px-3 py-2">
                <div className="text-[11px] text-ink-muted">
                  Remaining
                </div>
                <div className="mt-1 font-semibold text-lg text-brand-navy">
                  {formatDollars(portal.remainingCents)}
                </div>
              </div>
            </div>
          </Card>
        ) : null}

        {!planComplete && portal.plan.status === "active" ? (
          <Card title="Cancel plan">
            <CancelPlanSection
              token={token}
              serviceName={portal.booking.serviceName}
              appointmentDate={portal.booking.appointmentDate}
              paidCents={portal.paidCents}
              processingFeeCents={portal.processingFeeCents}
            />
          </Card>
        ) : null}

        <footer className="pt-4 pb-2 text-center text-xs text-ink-muted">
          Powered by{" "}
          <BlissWordmark />
        </footer>
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-none border border-brand-neutral bg-white/70 p-6 shadow-sm backdrop-blur-sm">
      <h2 className="mb-4 font-bold text-2xl text-brand-navy">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-brand-neutral py-2 last:border-b-0 text-sm">
      <span className="text-xs text-ink-muted">
        {label}
      </span>
      <span className="text-right text-ink">{value}</span>
    </div>
  );
}

function Line({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: "forest";
}) {
  return (
    <div className="flex items-baseline justify-between">
      <span className={emphasis === "forest" ? "text-emerald-700" : ""}>{label}</span>
      <span
        className={
          emphasis === "forest"
            ? "tabular-nums font-medium text-emerald-700"
            : "tabular-nums"
        }
      >
        {value}
      </span>
    </div>
  );
}

/**
 * Display bucket for a schedule row, read from the stored payment status
 * rather than derived from the due date.
 *
 * The settled design gives the guest exactly three states and no failure
 * state, so "processing", "failed" and "retrying" deliberately collapse into
 * "scheduled" rather than surfacing a label the design does not define. The
 * merchant screen keeps the full vocabulary; see scheduleDisplayStatus in
 * app/(merchant)/(authenticated)/bookings/[id]/page.tsx.
 */
function rowDisplayStatus(status: string): "paid" | "canceled" | "scheduled" {
  switch (status) {
    case "paid":
      return "paid";
    case "canceled":
      return "canceled";
    default:
      return "scheduled";
  }
}

type ScheduleEntry = PublicPlanPortal["schedule"][number];

/**
 * Numbers installment rows from 1 starting at the first non-deposit row.
 * The deposit stays labeled "Deposit"; it is not Installment 0.
 */
function labelSchedule(schedule: ScheduleEntry[]): { entry: ScheduleEntry; label: string }[] {
  const installmentCount = schedule.filter((e) => e.kind !== "deposit").length;
  let installmentNumber = 0;
  return schedule.map((entry) => {
    if (entry.kind === "deposit") {
      return { entry, label: "Deposit" };
    }
    installmentNumber += 1;
    return { entry, label: `Installment ${installmentNumber} of ${installmentCount}` };
  });
}

/**
 * "August 2, 2026" — the timeline's date format in the design. Neither shared
 * formatter produces it: formatScheduleDateLong prepends the weekday and
 * formatScheduleDateShort drops the year.
 */
function formatTimelineDate(iso: string): string {
  const parts = iso.split("-").map(Number);
  const y = parts[0] ?? 0;
  const m = parts[1] ?? 1;
  const d = parts[2] ?? 1;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

type TimelineState = "paid" | "next" | "scheduled" | "canceled";

function TimelineNode({ state }: { state: TimelineState }) {
  if (state === "next") {
    return (
      <div className="h-3 w-3 flex-none rounded-full border-[3.5px] border-brand-violet bg-white" />
    );
  }
  return (
    <div
      className={`h-3 w-3 flex-none rounded-full ${
        state === "paid" ? "bg-brand-violet" : "bg-sand-400"
      }`}
    />
  );
}

/**
 * The settled design's schedule timeline: a 1.5px rail down the left with a
 * 12px node per row. The lavender run marks the completed payments and the
 * warm grey the remainder; the boundary is the ring node on the next payment.
 *
 * Each rail segment hangs below its own node and is omitted on the last row,
 * which is how the export draws it. Continuity comes from every segment
 * filling its row's height, not from a border between rows.
 */
function ScheduleTimeline({ schedule }: { schedule: ScheduleEntry[] }) {
  const rows = labelSchedule(schedule);
  const nextIndex = rows.findIndex(
    ({ entry }) => rowDisplayStatus(entry.status) === "scheduled",
  );

  return (
    <ol>
      {rows.map(({ entry, label }, i) => {
        const base = rowDisplayStatus(entry.status);
        const state: TimelineState =
          base === "scheduled" && i === nextIndex ? "next" : base;
        const isLast = i === rows.length - 1;
        return (
          <li key={entry.sequence} className="flex gap-x-[26px]">
            <div className="flex w-[26px] flex-none flex-col items-center pt-2">
              <TimelineNode state={state} />
              {isLast ? null : (
                <div
                  className={`min-h-9 w-[1.5px] flex-1 ${
                    state === "paid" ? "bg-brand-lavender" : "bg-sand-300"
                  }`}
                />
              )}
            </div>

            {state === "next" ? (
              <div className="min-w-0 flex-1 pb-[34px]">
                <div className="-ml-[22px] flex flex-col gap-2 border-l-2 border-brand-violet pb-[4px] pl-5 pt-[2px]">
                  <div className="text-[13px] font-medium uppercase tracking-[0.05em] text-brand-violet">
                    Next payment · scheduled
                  </div>
                  <div className="grid grid-cols-[200px_minmax(0,1fr)_110px] items-baseline gap-x-5">
                    <div className="text-xl font-medium tracking-[-0.015em] text-ink-900">
                      {label}
                    </div>
                    <div className="text-base text-ink-600">
                      Automatic on {formatTimelineDate(entry.dueDate)}
                    </div>
                    <div />
                  </div>
                </div>
              </div>
            ) : (
              <div
                className={`grid min-w-0 flex-1 grid-cols-[200px_minmax(0,1fr)_110px] items-baseline gap-x-5 ${
                  isLast ? "" : "pb-[34px]"
                }`}
              >
                <div className="flex flex-col gap-1.5">
                  <div
                    className={`text-[13px] uppercase tracking-[0.06em] ${
                      state === "paid"
                        ? "font-medium text-brand-violet"
                        : "text-ink-400"
                    }`}
                  >
                    {state === "paid"
                      ? "Paid"
                      : state === "canceled"
                        ? "canceled"
                        : "Scheduled"}
                  </div>
                  <div
                    className={`text-xl font-medium tracking-[-0.015em] ${
                      state === "paid" ? "text-ink-900" : "text-ink-700"
                    }`}
                  >
                    {label}
                  </div>
                </div>
                <div className="text-base text-ink-400">
                  Due {formatTimelineDate(entry.dueDate)}
                </div>
                <div
                  className={`text-right text-xl ${
                    state === "paid" ? "text-ink-400" : "text-ink-700"
                  }`}
                >
                  {formatDollars(entry.amountCents)}
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function brandLabel(brand: string): string {
  switch (brand.toLowerCase()) {
    case "visa":
      return "Visa";
    case "mastercard":
      return "Mastercard";
    case "amex":
    case "american_express":
      return "Amex";
    case "discover":
      return "Discover";
    default:
      return brand.charAt(0).toUpperCase() + brand.slice(1);
  }
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
