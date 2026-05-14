import Link from "next/link";
import { notFound } from "next/navigation";
import { CopyLinkButton } from "@/components/merchant/CopyLinkButton";
import { fetchBookingServer } from "@/lib/auth";
import type { BookingStatus, PlanOption } from "@/lib/api";
import { formatCents, formatScheduleDate } from "@/lib/eligibility";

export default async function BookingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const booking = await fetchBookingServer(id);
  if (!booking) notFound();

  return (
    <>
      <header className="flex items-start justify-between gap-4">
        <div>
          <Link
            href="/bookings"
            className="text-xs text-ink-muted hover:underline"
          >
            ← Back to bookings
          </Link>
          <h1 className="mt-2 text-2xl font-medium">{booking.serviceName}</h1>
          <p className="mt-1 text-ink-muted">
            Appointment {formatScheduleDate(booking.appointmentDate)} ·{" "}
            {formatCents(booking.totalAmountCents)}
          </p>
        </div>
        <StatusBadge status={booking.status} />
      </header>

      <section className="mt-8 card p-5">
        <div className="text-xs text-ink-muted">Shareable link</div>
        <div className="mt-2 flex items-center gap-3">
          <code className="flex-1 truncate rounded-md bg-surface-subtle border border-surface-border px-3 py-2 text-xs font-mono">
            {booking.hostedUrl}
          </code>
          <CopyLinkButton url={booking.hostedUrl} />
        </div>
        <p className="mt-3 text-xs text-ink-soft">
          Send this to your customer in your own channel (email, contract,
          Instagram DM). They will land on a hosted plan setup page.
        </p>
      </section>

      <section className="mt-8 grid gap-4 md:grid-cols-2">
        <DetailCard
          label="Customer"
          value={
            booking.customerNameHint
              ? booking.customerNameHint
              : booking.customerEmailHint ?? "Not set"
          }
          subline={
            booking.customerNameHint && booking.customerEmailHint
              ? booking.customerEmailHint
              : undefined
          }
        />
        <DetailCard
          label="Cancellation policy"
          value={booking.cancellationPolicy ?? "No policy on file"}
        />
      </section>

      <section className="mt-8">
        <h2 className="text-xs uppercase tracking-wide text-ink-muted font-medium">
          Plan options for your customer
        </h2>
        <div className="mt-3">
          <EligibilitySection booking={booking} />
        </div>
      </section>
    </>
  );
}

function DetailCard({
  label,
  value,
  subline,
}: {
  label: string;
  value: string;
  subline?: string;
}) {
  return (
    <div className="card p-5">
      <div className="text-xs text-ink-muted">{label}</div>
      <div className="mt-1 text-sm whitespace-pre-line">{value}</div>
      {subline ? (
        <div className="mt-1 text-xs text-ink-soft">{subline}</div>
      ) : null}
    </div>
  );
}

function EligibilitySection({
  booking,
}: {
  booking: NonNullable<Awaited<ReturnType<typeof fetchBookingServer>>>;
}) {
  const eligibility = booking.eligibility;
  const planOptions = booking.planOptions ?? [];

  if (!eligibility) return null;

  if (!eligibility.eligible) {
    return (
      <div className="card-subtle">
        <div className="text-sm font-medium">No plan available for this date</div>
        <p className="mt-1 text-xs text-ink-muted">
          The appointment is in {eligibility.daysToAppointment} days. Plans need
          at least 6 weeks of runway. Your customer will see a prompt to pay you
          directly.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {planOptions.map((opt) => (
        <PlanOptionCard key={opt.frequency} option={opt} />
      ))}
    </div>
  );
}

function PlanOptionCard({ option }: { option: PlanOption }) {
  const evenSplit = option.finalPaymentAmountCents === option.perPaymentAmountCents;
  return (
    <div className="card p-5">
      <div className="flex items-baseline justify-between">
        <div className="text-sm font-medium capitalize">{option.frequency}</div>
        <div className="text-xs text-ink-muted">{option.numPayments} payments</div>
      </div>
      <div className="mt-1 text-sm">
        {evenSplit
          ? `${option.numPayments} × ${formatCents(option.perPaymentAmountCents)}`
          : `${option.numPayments - 1} × ${formatCents(option.perPaymentAmountCents)} then ${formatCents(option.finalPaymentAmountCents)}`}
      </div>
      <ol className="mt-3 space-y-1 text-xs text-ink-muted">
        {option.dueDates.map((d, i) => (
          <li key={d} className="flex justify-between">
            <span>
              {i === 0 ? "First charge" : `Payment ${i + 1}`}
            </span>
            <span className="tabular-nums">{formatScheduleDate(d)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

const STATUS_STYLES: Record<BookingStatus, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-surface-subtle text-ink-muted" },
  sent: { label: "Sent", className: "bg-lavender-100 text-lavender-700" },
  accepted: { label: "Accepted", className: "bg-emerald-50 text-emerald-700" },
  in_progress: { label: "In progress", className: "bg-emerald-100 text-emerald-700" },
  completed: { label: "Completed", className: "bg-emerald-100 text-emerald-700" },
  canceled: { label: "Canceled", className: "bg-red-100 text-red-700" },
};

function StatusBadge({ status }: { status: BookingStatus }) {
  const c = STATUS_STYLES[status];
  return (
    <span
      className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full font-medium ${c.className}`}
    >
      {c.label}
    </span>
  );
}
