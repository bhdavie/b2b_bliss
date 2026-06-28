"use client";

import { useState } from "react";
import Link from "next/link";
import { BlissWordmark } from "@/components/BlissWordmark";
import {
  fetchPlanPortal,
  formatDollars,
  formatScheduleDateLong,
  formatScheduleDateShort,
  type PublicPlanPortal,
} from "@/lib/publicApi";
import { PayEarlyButton } from "./PayEarlyButton";
import { UpdateCardSection } from "./UpdateCardSection";
import { CancelPlanSection } from "./CancelPlanSection";

export function PlanPortal({
  token,
  initial,
}: {
  token: string;
  initial: PublicPlanPortal;
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
  const nextDue = portal.schedule.find((s) => s.status === "scheduled");
  const planComplete = portal.plan.status === "completed";
  // Hawthorn gets the on-brand regional close-out; other merchants get a
  // neutral fallback so the celebration UI works for any completed plan.
  const enjoyCopy =
    portal.merchant.slug === "hawthorn-camden"
      ? "Enjoy Maine."
      : "Enjoy your stay.";

  return (
    <div className="min-h-screen bg-white text-ink font-body">
      <header className="border-b border-brand-neutral bg-gradient-to-b from-white to-brand-lavender/15">
        <div className="mx-auto max-w-3xl px-6 pt-5">
          <Link
            href="/account"
            className="text-xs font-medium uppercase tracking-[0.18em] text-brand-purple no-underline hover:underline"
          >
            Back to your plans
          </Link>
        </div>
        <div className="mx-auto max-w-3xl px-6 pb-10 pt-4 text-center">
          <p className="text-[11px] uppercase tracking-[0.25em] text-ink-muted">
            Your payment plan
          </p>
          <h1 className="mt-2 font-semibold text-3xl tracking-tight text-brand-navy">
            {portal.merchant.businessName}
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            {portal.booking.serviceName}
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-10 space-y-6">
        {planComplete ? (
          <section className="text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-none bg-brand-lavender text-white">
              <CheckIcon />
            </div>
            <h1 className="mt-4 font-semibold text-3xl text-brand-navy">
              You&apos;re all set
            </h1>
            <p className="mt-2 text-sm text-ink-muted">
              Your stay at {portal.merchant.businessName} is fully paid.{" "}
              {enjoyCopy}
            </p>
          </section>
        ) : null}

        <Card title="Booking">
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
                    : portal.plan.status === "active"
                    ? "rounded-none border border-brand-lavender bg-white px-3 py-0.5 text-xs font-medium uppercase tracking-[0.12em] text-brand-purple"
                    : "rounded-none bg-amber-100 px-3 py-0.5 text-xs font-medium uppercase tracking-[0.12em] text-amber-900"
                }
              >
                {portal.plan.status.replace(/_/g, " ")}
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
                <div className="text-[11px] uppercase tracking-[0.18em] text-white/80">
                  Paid to date
                </div>
                <div className="mt-1 font-semibold text-lg text-white">
                  {formatDollars(portal.paidCents)}
                </div>
              </div>
              <div className="rounded-none border-2 border-brand-lavender bg-white px-3 py-2">
                <div className="text-[11px] uppercase tracking-[0.18em] text-ink-muted">
                  Remaining
                </div>
                <div className="mt-1 font-semibold text-lg text-brand-navy">
                  {formatDollars(portal.remainingCents)}
                </div>
              </div>
            </div>
          </Card>
        ) : null}

        {nextDue && !planComplete ? (
          <Card title="Next payment">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
              <div>
                <div className="font-semibold text-3xl text-brand-navy">
                  {formatDollars(nextDue.amountCents)}
                </div>
                <div className="mt-1 text-xs uppercase tracking-[0.18em] text-ink-muted">
                  Due {formatScheduleDateLong(nextDue.dueDate)}
                </div>
              </div>
              <PayEarlyButton
                token={token}
                amount={nextDue.amountCents}
                onPaid={refresh}
              />
            </div>
          </Card>
        ) : null}

        <Card title="Schedule">
          <ol className="divide-y divide-brand-neutral">
            {labelSchedule(portal.schedule).map(({ entry, label }) => (
              <li
                key={entry.sequence}
                className="flex items-center justify-between gap-4 py-3 text-sm"
              >
                <div className="flex items-center gap-3">
                  <StatusPill status={entry.status} />
                  <div>
                    <div className="text-ink">{label}</div>
                    {entry.kind === "installment" || entry.status !== "paid" ? (
                      <div className="text-xs text-ink-muted">
                        {formatScheduleDateShort(entry.dueDate)}
                      </div>
                    ) : null}
                    {entry.status === "paid" && entry.paidAt ? (
                      <div className="text-xs text-ink-muted">
                        Paid {formatScheduleDateShort(entry.paidAt.slice(0, 10))}
                      </div>
                    ) : null}
                  </div>
                </div>
                <div className="font-semibold text-lg tabular-nums text-brand-navy">
                  {formatDollars(entry.amountCents)}
                </div>
              </li>
            ))}
          </ol>
        </Card>

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

        {portal.plan.status === "active" ? (
          <Card title="Cancel plan">
            <CancelPlanSection
              token={token}
              serviceName={portal.booking.serviceName}
              appointmentDate={portal.booking.appointmentDate}
              paidCents={portal.paidCents}
              processingFeeCents={portal.processingFeeCents}
              onCanceled={refresh}
            />
          </Card>
        ) : null}

        <footer className="pt-4 pb-12 text-center text-xs text-ink-muted">
          Powered by{" "}
          <BlissWordmark />
        </footer>
      </main>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-none border border-brand-neutral bg-white/70 p-6 shadow-sm backdrop-blur-sm">
      <h2 className="mb-4 font-semibold text-xl text-brand-navy">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-brand-neutral py-2 last:border-b-0 text-sm">
      <span className="text-xs uppercase tracking-[0.18em] text-ink-muted">
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

function StatusPill({ status }: { status: string }) {
  const cls = (() => {
    if (status === "paid") return "bg-brand-purple text-white";
    if (status === "scheduled") return "border border-brand-lavender bg-white text-brand-purple";
    if (status === "failed" || status === "retrying") return "bg-red-100 text-red-800";
    if (status === "canceled") return "bg-brand-neutral text-ink-muted";
    return "border border-brand-lavender bg-white text-brand-purple";
  })();
  return (
    <span
      className={`inline-block rounded-none px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${cls}`}
    >
      {status}
    </span>
  );
}

type ScheduleEntry = PublicPlanPortal["schedule"][number];

/**
 * Numbers installment rows from 1 starting at the first non-deposit row.
 * The deposit stays labeled "Deposit"; it is not Installment 0.
 */
function labelSchedule(schedule: ScheduleEntry[]): { entry: ScheduleEntry; label: string }[] {
  let installmentNumber = 0;
  return schedule.map((entry) => {
    if (entry.kind === "deposit") {
      return { entry, label: "Deposit" };
    }
    installmentNumber += 1;
    return { entry, label: `Installment ${installmentNumber}` };
  });
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
