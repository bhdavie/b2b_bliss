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
import { Panel, SectionHeading } from "@/components/ui/primitives";
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
  // Fill share for the progress bar, from the same two values the old balance
  // band printed. Clamped so a rounding drift or an overpayment cannot push the
  // fill past its track.
  const paidPercent =
    totalDue > 0
      ? Math.min(100, Math.max(0, (portal.paidCents / totalDue) * 100))
      : 0;
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
  const stay = formatStay(
    portal.booking.appointmentDate,
    portal.booking.checkoutDate,
  );

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="mb-8 flex flex-col gap-3">
        {backHref ? (
          <Link
            href={backHref}
            className="self-start text-[15px] text-brand-violet no-underline hover:underline"
          >
            Back to your plans
          </Link>
        ) : null}
        <div className="text-[42px] font-medium leading-[1.08] tracking-[-0.03em] text-ink-900">
          {portal.merchant.businessName}
        </div>
        <div className="text-lg text-ink-500">{portal.booking.serviceName}</div>
      </div>

      {/* Plan-level notices. Not drawn in the design, which shows one active,
          unrefunded plan; kept on the chrome-free treatment. */}
      {portal.plan.refundedAt ? (
        <div className="mb-8 flex items-center gap-3 rounded-panel border border-sand-200 px-7 py-5">
          <span className="rounded-full bg-brand-violet-tint px-[15px] py-[7px] text-[13px] font-medium uppercase tracking-[0.06em] text-brand-violet">
            Refunded
          </span>
          <span className="text-[17px] text-ink-500">
            {formatDollars(portal.plan.refundAmountCents ?? 0)} has been
            refunded to you.
          </span>
        </div>
      ) : null}

      {planComplete ? (
        <div className="mb-8 flex flex-col gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-lavender text-brand-violet-deep">
            <CheckIcon />
          </div>
          <div className="text-[42px] font-medium leading-[1.08] tracking-[-0.03em] text-ink-900">
            You&apos;re all set
          </div>
          <div className="text-lg text-ink-500">
            Your stay at {portal.merchant.businessName} is fully paid.{" "}
            {enjoyCopy}
          </div>
        </div>
      ) : null}

      {/* Booking — full content width, directly above the schedule. The four
          fields run across the row rather than stacking in two columns, since
          they now have the whole width the schedule uses. */}
      <Panel variant="filled" className="mb-7 px-7 py-[30px]">
        <SectionHeading className="mb-5">Booking</SectionHeading>
        <div className="grid grid-cols-2 gap-x-12 gap-y-6 sm:grid-cols-4">
          {portal.booking.customerNameHint ? (
            <Field
              label="Guest"
              value={portal.booking.customerNameHint}
            />
          ) : null}
          <Field label="Stay" value={stay ?? portal.booking.serviceName} />
          <Field
            label="Check-in"
            value={formatScheduleDateLong(portal.booking.appointmentDate)}
          />
          <div className="flex flex-col gap-[7px]">
            <div className="text-[15px] text-ink-400">Plan status</div>
            <div className="flex">
              <span className="rounded-full bg-brand-violet-tint px-[15px] py-[7px] text-[13px] font-medium uppercase tracking-[0.06em] text-brand-violet">
                {displayStatus.replace(/_/g, " ")}
              </span>
            </div>
          </div>
        </div>
      </Panel>

      {/* Plan progress — replaces the balance band. Decorative: the two figures
          it encodes are printed underneath, so the bar itself is hidden from
          assistive tech rather than carrying a redundant progressbar role. */}
      <div className="mb-9 flex flex-col gap-4">
        <div
          aria-hidden="true"
          className="h-2 w-full overflow-hidden rounded-full bg-sand-200"
        >
          <div
            className="h-full rounded-full bg-brand-violet"
            style={{ width: `${paidPercent}%` }}
          />
        </div>
        <div className="flex items-start justify-between gap-6">
          <div className="flex flex-col gap-[7px]">
            <div className="text-[15px] text-ink-400">Paid to date</div>
            <div className="text-[17px] font-medium text-ink-900">
              {formatDollars(portal.paidCents)}
            </div>
          </div>
          <div className="flex flex-col items-end gap-[7px]">
            <div className="text-[15px] text-ink-400">Remaining</div>
            <div className="text-[17px] font-medium text-ink-900">
              {formatDollars(portal.remainingCents)}
            </div>
          </div>
        </div>
      </div>

      {/* Row 1 — schedule, with next payment and payment method beside it */}
      <div className="mb-7 grid grid-cols-1 items-start gap-x-10 gap-y-9 xl:grid-cols-[minmax(0,1fr)_minmax(0,300px)]">
        <Panel variant="filled" className="px-7 py-[30px]">
          <SectionHeading className="mb-5">Schedule</SectionHeading>
          <ScheduleTimeline schedule={portal.schedule} />
        </Panel>

        <div className="flex flex-col gap-5">
          {hasUpcoming ? (
            <Panel variant="filled" className="px-7 pb-8 pt-[30px]">
              <SectionHeading className="mb-[18px] font-medium text-brand-violet">
                Next payment
              </SectionHeading>
              <div className="mb-3 text-[44px] font-medium leading-none tracking-[-0.035em] text-ink-900">
                {formatDollars(nextDueAmount ?? 0)}
              </div>
              <div className="mb-[26px] text-[17px] text-ink-500">
                Due {formatTimelineDate(nextDueDate ?? "")}
              </div>
              <PayEarlyButton
                token={token}
                amount={nextDueAmount ?? 0}
                remaining={portal.remainingCents}
                onPaid={refresh}
              />
            </Panel>
          ) : null}

          {!planComplete ? (
            <Panel variant="filled" className="px-7 py-[30px]">
              <SectionHeading className="mb-5">Payment method</SectionHeading>
              {portal.card ? (
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3.5">
                    <div className="h-7 w-[42px] flex-none rounded-[5px] bg-ink-900" />
                    <div className="flex flex-col gap-[3px]">
                      <div className="text-base text-ink-900">
                        {brandLabel(portal.card.brand)} ····{" "}
                        {portal.card.lastFour}
                      </div>
                      <div className="text-sm text-ink-400">
                        Expires {String(portal.card.expMonth).padStart(2, "0")}/
                        {String(portal.card.expYear).slice(-2)}
                      </div>
                    </div>
                  </div>
                  <UpdateCardSection
                    token={token}
                    stripeConfigured={portal.stripe.configured}
                    stripePublishableKey={portal.stripe.publishableKey}
                    onReplaced={refresh}
                  />
                </div>
              ) : (
                <div className="flex items-center justify-between gap-4">
                  <div className="text-base text-ink-400">No card on file.</div>
                  <UpdateCardSection
                    token={token}
                    stripeConfigured={portal.stripe.configured}
                    stripePublishableKey={portal.stripe.publishableKey}
                    onReplaced={refresh}
                  />
                </div>
              )}
            </Panel>
          ) : null}
        </div>
      </div>

      {/* Row 2 — the accounting breakdown, in the column it has always occupied,
          with Cancel plan beside it in the left column. Cancel used to sit in a
          band of its own below this row, which left a tall gap under the
          shortened schedule.

          Explicit col/row placement rather than DOM order: the summary keeps
          its column via col-start, and Cancel is pinned to row 1 of column 1 so
          the two tops line up. Leaving DOM order as summary-then-cancel keeps
          the single-column stacking below xl exactly as it reads today. */}
      <div className="grid grid-cols-1 items-start gap-x-10 gap-y-9 pb-10 xl:grid-cols-[minmax(0,1fr)_minmax(0,300px)]">
        <Panel
          variant="filled"
          className="px-7 py-[30px] xl:col-start-2 xl:row-start-1"
        >
          <SectionHeading className="mb-5">Plan summary</SectionHeading>
          <div className="flex flex-col">
            {hasDiscount && portal.booking.originalTotalAmountCents != null ? (
              <>
                <SummaryLine
                  label="Subtotal"
                  value={formatDollars(portal.booking.originalTotalAmountCents)}
                />
                <SummaryLine
                  label={`Plan discount (${savingsPercent}%)`}
                  value={`−${formatDollars(savings)}`}
                />
              </>
            ) : (
              <SummaryLine
                label="Subtotal"
                value={formatDollars(portal.plan.totalAmountCents)}
              />
            )}
            <SummaryLine
              label="Processing fee"
              value={formatDollars(portal.processingFeeCents)}
              last
            />
            <div className="h-px bg-sand-300" />
            <div className="flex items-baseline justify-between pt-[18px]">
              <div className="text-[17px] font-medium text-ink-900">Total</div>
              <div className="text-2xl font-medium tracking-[-0.02em] text-ink-900">
                {formatDollars(totalDue)}
              </div>
            </div>
          </div>
        </Panel>

        {/* Not drawn in the design, which shows no cancel affordance. Kept on
            the chrome-free treatment, now beside the accounting. */}
        {!planComplete && portal.plan.status === "active" ? (
          <div className="flex flex-col xl:col-start-1 xl:row-start-1">
            <SectionHeading className="mb-5">Cancel plan</SectionHeading>
            <div className="max-w-[560px]">
              <CancelPlanSection
                token={token}
                serviceName={portal.booking.serviceName}
                appointmentDate={portal.booking.appointmentDate}
                paidCents={portal.paidCents}
                processingFeeCents={portal.processingFeeCents}
              />
            </div>
          </div>
        ) : null}
      </div>


      <div className="-mx-6 border-t border-sand-200 px-6 pb-8 pt-7 text-sm text-ink-400 xl:-mx-16 xl:px-16">
        Powered by <BlissWordmark />
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-[7px]">
      <div className="text-[15px] text-ink-400">{label}</div>
      <div className="text-[19px] font-medium tracking-[-0.01em] text-ink-900">
        {value}
      </div>
    </div>
  );
}

function SummaryLine({
  label,
  value,
  last = false,
}: {
  label: string;
  value: string;
  last?: boolean;
}) {
  return (
    <div
      className={`flex justify-between text-[17px] ${last ? "pb-[18px]" : "pb-4"}`}
    >
      <div className="text-ink-500">{label}</div>
      <div className="tabular-nums text-ink-900">{value}</div>
    </div>
  );
}

/**
 * "Dec 25 – Dec 28, 2026 · 3 nights" from the stay's two dates.
 *
 * Returns null when there is no check-out date: neither the range nor the
 * night count can be derived from check-in alone, and the caller falls back to
 * the booking's service name rather than showing a half-formed value.
 */
function formatStay(checkIn: string, checkOut: string | null): string | null {
  if (!checkOut) return null;
  const a = parseIsoDate(checkIn);
  const b = parseIsoDate(checkOut);
  if (!a || !b) return null;
  const nights = Math.round((b.getTime() - a.getTime()) / 86_400_000);
  if (nights < 1) return null;
  const short = (d: Date) =>
    d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${short(a)} – ${short(b)}, ${b.getFullYear()} · ${nights} ${
    nights === 1 ? "night" : "nights"
  }`;
}

function parseIsoDate(iso: string): Date | null {
  const parts = iso.split("-").map(Number);
  const y = parts[0];
  const m = parts[1];
  const d = parts[2];
  if (!y || !m || !d) return null;
  const dt = new Date(y, m - 1, d);
  return Number.isNaN(dt.getTime()) ? null : dt;
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

        // Line two, assembled from the same strings the rows used before: the
        // dated phrase, then the status, joined by a middle dot. The next
        // payment keeps its "Next payment" marker inline rather than as an
        // eyebrow above the row.
        const statusWord =
          state === "paid"
            ? "Paid"
            : state === "canceled"
              ? "Canceled"
              : "Scheduled";
        const meta =
          state === "next"
            ? `Automatic on ${formatTimelineDate(entry.dueDate)} · Next payment · ${statusWord}`
            : `Due ${formatTimelineDate(entry.dueDate)} · ${statusWord}`;

        return (
          <li key={entry.sequence} className="flex gap-x-[26px]">
            <div className="flex w-[26px] flex-none flex-col items-center pt-1.5">
              <TimelineNode state={state} />
              {isLast ? null : (
                <div
                  className={`min-h-4 w-[1.5px] flex-1 ${
                    state === "paid" ? "bg-brand-lavender" : "bg-sand-300"
                  }`}
                />
              )}
            </div>

            <div className={`min-w-0 flex-1 ${isLast ? "" : "pb-4"}`}>
              {/* Line one: label left, amount right, both at body size. */}
              <div className="flex items-baseline justify-between gap-4">
                {/* A canceled row is inactive, not merely unpaid: its label and
                    amount drop to the muted tone, so it reads as struck from
                    the plan rather than pending. */}
                <div
                  className={`min-w-0 text-[17px] font-medium tracking-[-0.01em] ${
                    state === "canceled" ? "text-ink-400" : "text-ink-900"
                  }`}
                >
                  {label}
                </div>
                <div
                  className={`flex-none text-right text-[17px] ${
                    state === "canceled" ? "text-ink-400" : "text-ink-700"
                  }`}
                >
                  {formatDollars(entry.amountCents)}
                </div>
              </div>

              {/* Line two: date and status together, muted and smaller. */}
              <div className="mt-1 text-[13px] text-ink-400">{meta}</div>
            </div>
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
