import Link from "next/link";
import { notFound } from "next/navigation";
import { CopyLinkButton } from "@/components/merchant/CopyLinkButton";
import { ManagerActions } from "@/components/merchant/ManagerActions";
import { fetchBookingServer } from "@/lib/auth";
import {
  fetchPlanPortal,
  formatDollars,
  formatScheduleDateLong,
  formatScheduleDateShort,
  type PublicPlanPortal,
} from "@/lib/publicApi";

type Booking = NonNullable<Awaited<ReturnType<typeof fetchBookingServer>>>;

export default async function BookingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const booking = await fetchBookingServer(id);
  if (!booking) notFound();
  // Same record the guest portal reads (shared source of truth), keyed by token.
  const portal = await fetchPlanPortal(booking.bookingToken);

  return (
    <>
      <header>
        <Link href="/bookings" className="text-sm font-medium text-brand-purple hover:underline">
          ← Back to bookings
        </Link>
        <h1 className="mt-3 text-3xl font-bold text-brand-navy">{booking.serviceName}</h1>
        <p className="mt-1 text-brand-navy/70">
          {booking.customerNameHint ?? booking.customerEmailHint ?? "Guest pending"}
        </p>
      </header>

      {portal ? (
        <PlanDetail booking={booking} portal={portal} />
      ) : (
        <NoPlan booking={booking} />
      )}
    </>
  );
}

function PlanDetail({ booking, portal }: { booking: Booking; portal: PublicPlanPortal }) {
  const totalDue = portal.plan.totalAmountCents + portal.processingFeeCents;
  const refunded = portal.plan.refundedAt != null;
  const displayStatus = portal.complete ? "completed" : portal.plan.status;
  const now = new Date();
  const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  return (
    <div className="mt-6 space-y-5">
      {refunded ? (
        <div className="flex items-center gap-3 border border-brand-purple/40 bg-brand-lavender/15 px-4 py-3">
          <span className="inline-flex items-center gap-1.5 bg-brand-purple px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white">
            Refunded
          </span>
          <span className="text-sm text-brand-navy">
            {formatDollars(portal.plan.refundAmountCents ?? 0)} refunded to the guest
            {portal.plan.refundedAt
              ? ` on ${formatScheduleDateLong(portal.plan.refundedAt.slice(0, 10))}`
              : ""}
            .
          </span>
        </div>
      ) : null}

      <Card title="Booking">
        {booking.customerNameHint ? <Row label="Guest" value={booking.customerNameHint} /> : null}
        {booking.customerEmailHint ? <Row label="Email" value={booking.customerEmailHint} /> : null}
        <Row label="Stay" value={booking.serviceName} />
        <Row label="Check-in" value={formatScheduleDateLong(booking.appointmentDate)} />
        {booking.checkoutDate ? (
          <Row label="Check-out" value={formatScheduleDateLong(booking.checkoutDate)} />
        ) : null}
        <Row
          label="Plan status"
          value={<StatusBadge status={displayStatus} />}
        />
      </Card>

      <Card title="Plan summary">
        <div className="space-y-2 text-sm text-ink">
          <Line label="Subtotal" value={formatDollars(portal.plan.totalAmountCents)} />
          <Line label="Processing fee" value={`+${formatDollars(portal.processingFeeCents)}`} />
        </div>
        <div className="mt-3 flex items-baseline justify-between border-t border-brand-neutral pt-3">
          <span className="text-base font-semibold text-brand-navy">Total</span>
          <span className="text-2xl font-bold tabular-nums text-brand-navy">{formatDollars(totalDue)}</span>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Stat label="Paid to date" value={formatDollars(portal.paidCents)} />
          <Stat label="Remaining" value={formatDollars(portal.remainingCents)} />
        </div>
      </Card>

      <Card title="Schedule">
        <ol className="divide-y divide-brand-neutral">
          {labelSchedule(portal.schedule).map(({ entry, label }) => {
            const rowStatus =
              entry.status === "canceled"
                ? "canceled"
                : entry.dueDate <= todayIso
                  ? "paid"
                  : "scheduled";
            return (
              <li key={entry.sequence} className="flex items-center justify-between gap-4 py-3 text-sm">
                <div className="flex items-center gap-3">
                  <SchedulePill status={rowStatus} />
                  <div>
                    <div className="text-ink">{label}</div>
                    <div className="text-xs text-brand-navy/55">
                      {rowStatus === "paid" ? "Due " : ""}
                      {formatScheduleDateShort(entry.dueDate)}
                    </div>
                  </div>
                </div>
                <div className="text-base font-semibold tabular-nums text-brand-navy">
                  {formatDollars(entry.amountCents)}
                </div>
              </li>
            );
          })}
        </ol>
      </Card>

      <Card title="Payment method">
        {portal.card ? (
          <div className="text-sm">
            <div className="text-base font-semibold text-brand-navy">
              {brandLabel(portal.card.brand)} •••• {portal.card.lastFour}
            </div>
            <div className="mt-1 text-xs text-brand-navy/55">
              Expires {String(portal.card.expMonth).padStart(2, "0")}/{String(portal.card.expYear).slice(-2)}
            </div>
          </div>
        ) : (
          <p className="text-sm text-brand-navy/55">No card on file.</p>
        )}
      </Card>

      <ManagerActions
        planId={portal.plan.id}
        planStatus={portal.plan.status}
        refunded={refunded}
        refundAmountCents={portal.plan.refundAmountCents}
        paidCents={portal.paidCents}
      />
    </div>
  );
}

function NoPlan({ booking }: { booking: Booking }) {
  return (
    <div className="mt-6 space-y-5">
      <Card title="Booking">
        <Row label="Stay" value={booking.serviceName} />
        <Row label="Check-in" value={formatScheduleDateLong(booking.appointmentDate)} />
        <Row label="Total" value={formatDollars(booking.totalAmountCents)} />
      </Card>
      <Card title="Plan">
        <p className="text-sm text-brand-navy/65">
          No plan yet. Share the link below so your guest can set up a payment plan.
        </p>
        <div className="mt-3 flex items-center gap-3">
          <code className="flex-1 truncate border border-brand-neutral bg-brand-cream/50 px-3 py-2 text-xs font-mono text-ink">
            {booking.hostedUrl}
          </code>
          <CopyLinkButton url={booking.hostedUrl} />
        </div>
      </Card>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border border-brand-neutral bg-white p-6 shadow-card">
      <h2 className="mb-4 text-xl font-bold text-brand-navy">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-brand-neutral py-2.5 text-sm last:border-b-0">
      <span className="text-xs font-medium uppercase tracking-wide text-brand-navy/55">{label}</span>
      <span className="text-right text-ink">{value}</span>
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-brand-navy/70">{label}</span>
      <span className="tabular-nums text-ink">{value}</span>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-brand-neutral bg-brand-cream/30 px-3 py-2.5">
      <div className="text-[11px] uppercase tracking-wide text-brand-navy/55">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums text-ink">{value}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "canceled"
      ? "bg-brand-neutral/50 text-ink-muted"
      : status === "completed"
        ? "bg-brand-navy text-white"
        : status === "active"
          ? "bg-brand-lavender text-white"
          : "bg-brand-cream text-brand-navy ring-1 ring-inset ring-brand-dusty";
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${cls}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

function SchedulePill({ status }: { status: string }) {
  const cls =
    status === "paid"
      ? "bg-brand-purple text-white"
      : status === "canceled"
        ? "bg-brand-neutral/60 text-ink-muted"
        : "border border-brand-lavender bg-white text-brand-purple";
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cls}`}>
      {status}
    </span>
  );
}

type ScheduleEntry = PublicPlanPortal["schedule"][number];

function labelSchedule(schedule: ScheduleEntry[]): { entry: ScheduleEntry; label: string }[] {
  let installmentNumber = 0;
  return schedule.map((entry) => {
    if (entry.kind === "deposit") return { entry, label: "Deposit" };
    installmentNumber += 1;
    return { entry, label: `Installment ${installmentNumber}` };
  });
}

function brandLabel(brand: string): string {
  const b = brand.toLowerCase();
  if (b === "visa") return "Visa";
  if (b === "mastercard") return "Mastercard";
  if (b === "amex" || b === "american_express") return "Amex";
  if (b === "discover") return "Discover";
  return brand.charAt(0).toUpperCase() + brand.slice(1);
}
