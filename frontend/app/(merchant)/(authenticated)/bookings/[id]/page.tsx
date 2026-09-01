import Link from "next/link";
import { notFound } from "next/navigation";
import { CopyLinkButton } from "@/components/merchant/CopyLinkButton";
import { ManagerActions } from "@/components/merchant/ManagerActions";
import { ModifyBookingAction } from "@/components/merchant/ModifyBookingAction";
import { Panel, SectionHeading } from "@/components/ui/primitives";
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

  // The back link, service name and guest line used to be a <header> on the
  // sand ground above the cards. They are the first card's head now.
  //
  // The service name is on SectionHeading, not the 22px medium it landed on
  // first. A record's name and a card's heading looked like two different kinds
  // of thing while /plan/[token] still had a 44px title of its own; once the
  // property name there became a SectionHeading, keeping 22px here would have
  // been the same content in two treatments on two detail pages. One treatment
  // for every heading in both surfaces, no exceptions.
  const head = (
    <div className="mb-6 flex flex-col border-b border-sand-100 pb-5">
      <Link
        href="/bookings"
        className="mb-4 self-start text-[15px] text-brand-violet no-underline hover:underline"
      >
        ← Back to bookings
      </Link>
      <SectionHeading className="mb-2.5">{booking.serviceName}</SectionHeading>
      <p className="text-[17px] text-ink-500">
        {booking.customerNameHint ?? booking.customerEmailHint ?? "Guest pending"}
      </p>
    </div>
  );

  return portal ? (
    <PlanDetail booking={booking} portal={portal} head={head} />
  ) : (
    <NoPlan booking={booking} head={head} />
  );
}

function PlanDetail({
  booking,
  portal,
  head,
}: {
  booking: Booking;
  portal: PublicPlanPortal;
  head: React.ReactNode;
}) {
  const totalDue = portal.plan.totalAmountCents + portal.processingFeeCents;
  const refunded = portal.plan.refundedAt != null;
  const displayStatus = portal.complete ? "completed" : portal.plan.status;

  return (
    <div className="flex flex-col gap-7">
      {/* Was a lavender-tinted bordered strip, the one block on this page that
          held content on something other than a white card. Now a card like
          everything else, matching the refund notice on the guest plan screen. */}
      {refunded ? (
        <Panel variant="filled" className="flex-row items-center gap-3 px-7 py-5">
          <span className="rounded-full bg-brand-violet-tint px-[15px] py-[7px] text-[13px] font-medium uppercase tracking-[0.06em] text-brand-violet">
            Refunded
          </span>
          <span className="text-[17px] text-ink-500">
            {formatDollars(portal.plan.refundAmountCents ?? 0)} refunded to the guest
            {portal.plan.refundedAt
              ? ` on ${formatScheduleDateLong(portal.plan.refundedAt.slice(0, 10))}`
              : ""}
            .
          </span>
        </Panel>
      ) : null}

      <Card title="Booking" head={head}>
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
        <div className="space-y-2.5">
          <Line label="Subtotal" value={formatDollars(portal.plan.totalAmountCents)} />
          <Line label="Processing fee" value={`+${formatDollars(portal.processingFeeCents)}`} />
        </div>
        <div className="mt-[18px] flex items-baseline justify-between border-t border-sand-300 pt-[18px]">
          <span className="text-[17px] font-medium text-ink-900">Total</span>
          <span className="text-2xl font-medium tracking-[-0.02em] tabular-nums text-ink-900">
            {formatDollars(totalDue)}
          </span>
        </div>
        <div className="mt-7 grid grid-cols-2 gap-3">
          <Stat label="Paid to date" value={formatDollars(portal.paidCents)} />
          <Stat label="Remaining" value={formatDollars(portal.remainingCents)} />
        </div>
      </Card>

      <Card title="Schedule">
        <ol className="divide-y divide-sand-100">
          {labelSchedule(portal.schedule).map(({ entry, label }) => {
            // Drive the pill from the row's REAL status (rail-agnostic), not the
            // due date. A Mews installment captures asynchronously, so it can sit
            // in "processing" on its due date; a date-only rule would mislabel
            // that as paid. Same statuses apply to the Stripe rail.
            const rowStatus = scheduleDisplayStatus(entry.status);
            return (
              <li key={entry.sequence} className="flex items-center justify-between gap-4 py-4">
                <div className="flex items-center gap-3">
                  <SchedulePill status={rowStatus} />
                  <div>
                    <div className="text-[17px] text-ink-900">{label}</div>
                    <div className="mt-0.5 text-[13px] text-ink-400">
                      {SCHEDULE_DATE_PREFIX[rowStatus]}
                      {formatScheduleDateShort(entry.dueDate)}
                    </div>
                  </div>
                </div>
                <div className="text-[17px] font-medium tabular-nums text-ink-900">
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

      {portal.plan.status === "active" ? (
        <ModifyBookingAction
          bookingId={booking.id}
          currentAppointmentDate={booking.appointmentDate}
          currentCheckoutDate={booking.checkoutDate}
          currentTotalCents={booking.totalAmountCents}
        />
      ) : null}

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

function NoPlan({ booking, head }: { booking: Booking; head: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-7">
      <Card title="Booking" head={head}>
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

/**
 * Was a square, shadowed, brand-neutral box with a 20px bold brand-navy h2 —
 * the last of the pre-redesign card system in the merchant app. Now Panel plus
 * the one in-card heading treatment, so this page matches every other screen.
 */
function Card({
  title,
  head,
  children,
}: {
  title: string;
  /** Page head, rendered above the heading on the first card only. */
  head?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Panel variant="filled" className="px-7 py-[30px]">
      {head}
      <SectionHeading className="mb-5">{title}</SectionHeading>
      {children}
    </Panel>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-sand-100 py-4 last:border-b-0">
      {/* text-xs (12px), NOT the 13px SectionHeading size. This labels a field
          in a row, so it belongs with /dashboard's FieldRow labels and the
          /bookings column headers, which are all 12px. At 13px it was sitting
          in the section-heading family and made "Guest" here look like the same
          kind of thing as "Booking" above it. */}
      <span className="text-xs uppercase tracking-[0.08em] text-ink-400">
        {label}
      </span>
      <span className="text-right text-[17px] text-ink-900">{value}</span>
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between text-[17px]">
      <span className="text-ink-500">{label}</span>
      <span className="tabular-nums text-ink-900">{value}</span>
    </div>
  );
}

// Was a square, cream-tinted, brand-neutral box — a second surface tint inside
// a card. Now the same label-over-figure pair the guest plan screen uses, with
// no box of its own: one card, one fill.
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-[7px]">
      <div className="text-[15px] text-ink-400">{label}</div>
      <div className="text-[19px] font-medium tabular-nums text-ink-900">
        {value}
      </div>
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

// Display buckets for a schedule row, derived from the real payment status of
// the installment (both rails share this vocabulary). "retrying" folds into
// "failed" for the pill; "processing" is its own state so an in-flight Mews
// capture never reads as paid or scheduled.
type ScheduleDisplayStatus = "paid" | "processing" | "failed" | "canceled" | "scheduled";

function scheduleDisplayStatus(status: string): ScheduleDisplayStatus {
  switch (status) {
    case "paid":
      return "paid";
    case "processing":
      return "processing";
    case "failed":
    case "retrying":
      return "failed";
    case "canceled":
      return "canceled";
    default:
      return "scheduled";
  }
}

const SCHEDULE_PILL: Record<ScheduleDisplayStatus, { label: string; cls: string }> = {
  paid: { label: "Paid", cls: "bg-brand-purple text-white" },
  processing: { label: "Processing", cls: "bg-amber-100 text-amber-800" },
  failed: { label: "Failed", cls: "bg-red-100 text-red-700" },
  canceled: { label: "Canceled", cls: "bg-brand-neutral/60 text-ink-muted" },
  scheduled: { label: "Scheduled", cls: "border border-brand-lavender bg-white text-brand-purple" },
};

const SCHEDULE_DATE_PREFIX: Record<ScheduleDisplayStatus, string> = {
  paid: "Paid ",
  processing: "In progress · due ",
  failed: "Failed ",
  canceled: "Canceled ",
  scheduled: "Due ",
};

function SchedulePill({ status }: { status: ScheduleDisplayStatus }) {
  const { label, cls } = SCHEDULE_PILL[status];
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cls}`}>
      {label}
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
