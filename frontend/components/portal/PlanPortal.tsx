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
import { SectionHeading } from "@/components/ui/primitives";
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
  const stay = formatStay(
    portal.booking.appointmentDate,
    portal.booking.checkoutDate,
  );

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="mb-11 flex flex-col gap-3">
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
        <div className="mb-11 flex items-center gap-3 rounded-panel border border-sand-200 px-7 py-5">
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
        <div className="mb-11 flex flex-col gap-3">
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

      {/* Balance band */}
      <div className="mb-14 flex flex-col gap-4 border-y border-sand-300 pb-9 pt-[34px]">
        <SectionHeading>Remaining</SectionHeading>
        <div className="text-[64px] font-medium leading-none tracking-[-0.04em] text-ink-900">
          {formatDollars(portal.remainingCents)}
        </div>
        <div className="text-[17px] text-ink-500">
          Paid to date{" "}
          <span className="font-medium text-ink-900">
            {formatDollars(portal.paidCents)}
          </span>{" "}
          of {formatDollars(totalDue)}
        </div>
      </div>

      {/* Row 1 — schedule, with next payment and payment method beside it */}
      <div className="mb-16 grid grid-cols-1 items-start gap-x-10 gap-y-12 xl:grid-cols-[minmax(0,1fr)_minmax(0,300px)]">
        <div className="flex flex-col">
          <SectionHeading className="mb-8">Schedule</SectionHeading>
          <ScheduleTimeline schedule={portal.schedule} />
        </div>

        <div className="flex flex-col gap-5">
          {hasUpcoming ? (
            <div className="flex flex-col rounded-panel border border-sand-200 px-7 pb-8 pt-[30px]">
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
                onPaid={refresh}
              />
              <div className="mt-5 text-sm leading-[1.55] text-ink-400">
                Nothing to do. We&apos;ll charge the card below automatically.
              </div>
            </div>
          ) : null}

          {!planComplete ? (
            <div className="flex flex-col rounded-panel border border-sand-200 px-7 py-[30px]">
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
            </div>
          ) : null}
        </div>
      </div>

      <div className="mb-[52px] h-px bg-sand-300" />

      {/* Row 2 — booking beside the accounting breakdown */}
      <div className="grid grid-cols-1 items-start gap-x-10 gap-y-12 pb-14 xl:grid-cols-[minmax(0,1fr)_minmax(0,300px)]">
        <div className="flex flex-col">
          <SectionHeading className="mb-7">Booking</SectionHeading>
          <div className="grid grid-cols-1 gap-x-12 gap-y-[30px] sm:grid-cols-2">
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
        </div>

        <div className="flex flex-col">
          <SectionHeading className="mb-7">Plan summary</SectionHeading>
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
        </div>
      </div>

      {/* Not drawn in the design, which shows no cancel affordance. Kept on the
          chrome-free treatment, below the accounting. */}
      {!planComplete && portal.plan.status === "active" ? (
        <div className="flex flex-col pb-14">
          <SectionHeading className="mb-7">Cancel plan</SectionHeading>
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
                  <div className="grid grid-cols-[minmax(0,1fr)] items-baseline gap-x-5 sm:grid-cols-[200px_minmax(0,1fr)_110px]">
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
                className={`grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-5 sm:grid-cols-[200px_minmax(0,1fr)_110px] ${
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
                        ? "Canceled"
                        : "Scheduled"}
                  </div>
                  {/* A canceled row is inactive, not merely unpaid: its title
                      and amount drop to the muted tone the label already uses,
                      so it reads as struck from the plan rather than pending. */}
                  <div
                    className={`text-xl font-medium tracking-[-0.015em] ${
                      state === "paid"
                        ? "text-ink-900"
                        : state === "canceled"
                          ? "text-ink-400"
                          : "text-ink-700"
                    }`}
                  >
                    {label}
                  </div>
                </div>
                <div className="order-last col-span-2 text-base text-ink-400 sm:order-none sm:col-span-1">
                  Due {formatTimelineDate(entry.dueDate)}
                </div>
                <div
                  className={`text-right text-xl ${
                    state === "scheduled" ? "text-ink-700" : "text-ink-400"
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
