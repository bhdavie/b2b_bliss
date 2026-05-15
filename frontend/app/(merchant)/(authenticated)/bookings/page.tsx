import Link from "next/link";
import { fetchBookingsServer, fetchStripeStatusServer } from "@/lib/auth";
import { formatCents, formatScheduleDate } from "@/lib/eligibility";
import type { Booking, BookingStatus } from "@/lib/api";

export default async function BookingsPage() {
  const [stripeStatus, list] = await Promise.all([
    fetchStripeStatusServer(),
    fetchBookingsServer(),
  ]);
  const chargesEnabled = stripeStatus?.status === "charges_enabled";
  const stripeUnconfigured = stripeStatus?.configured === false;
  const canCreate = chargesEnabled || stripeUnconfigured;
  const bookings = list?.bookings ?? [];

  return (
    <>
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-medium">Bookings</h1>
          <p className="mt-1 text-ink-muted">
            Create a booking and share the payment plan link with your customer.
          </p>
        </div>
        {canCreate ? (
          <Link href="/bookings/new" className="btn-primary">
            New booking
          </Link>
        ) : (
          <button
            type="button"
            className="btn-primary"
            disabled
            title="Finish Stripe setup before creating bookings"
          >
            New booking
          </button>
        )}
      </header>

      {!canCreate ? (
        <div className="mt-8 card p-10 text-center">
          <div className="text-sm font-medium">
            Connect Stripe before you can create a booking
          </div>
          <p className="mt-2 text-ink-muted text-sm">
            Bliss collects customer payments and routes them to your bank
            account through Stripe Connect.
          </p>
          <Link href="/settings" className="mt-4 inline-block btn-primary">
            Go to payouts
          </Link>
        </div>
      ) : bookings.length === 0 ? (
        <div className="mt-8 card p-10 text-center">
          <div className="text-sm font-medium">No bookings yet</div>
          <p className="mt-1 text-ink-muted text-sm">
            Create your first booking to generate a shareable payment plan link.
          </p>
          <Link href="/bookings/new" className="mt-4 inline-block btn-primary">
            New booking
          </Link>
        </div>
      ) : (
        <div className="mt-8 card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-muted bg-surface-subtle border-b border-surface-border">
                <th className="px-4 py-2.5 font-medium">Service</th>
                <th className="px-4 py-2.5 font-medium">Customer</th>
                <th className="px-4 py-2.5 font-medium">Appointment</th>
                <th className="px-4 py-2.5 font-medium text-right">Total</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {bookings.map((b) => (
                <BookingRow key={b.id} booking={b} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function BookingRow({ booking }: { booking: Booking }) {
  return (
    <tr className="border-b last:border-b-0 border-surface-border hover:bg-surface-subtle/50">
      <td className="px-4 py-3">
        <Link
          href={`/bookings/${booking.id}`}
          className="font-medium text-ink hover:underline"
        >
          {booking.serviceName}
        </Link>
        {booking.source === "customer_initiated" ? (
          <span
            className="ml-2 inline-flex items-center rounded-full bg-lavender-100 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-lavender-700"
            title="Created by the customer from this merchant's checkout link"
          >
            From checkout link
          </span>
        ) : null}
      </td>
      <td className="px-4 py-3 text-ink-muted">
        {booking.customerNameHint ?? booking.customerEmailHint ?? (
          <span className="text-ink-soft">—</span>
        )}
      </td>
      <td className="px-4 py-3 text-ink-muted">
        {formatScheduleDate(booking.appointmentDate)}
        {booking.checkoutDate ? (
          <span className="text-ink-soft"> → {formatScheduleDate(booking.checkoutDate)}</span>
        ) : null}
      </td>
      <td className="px-4 py-3 text-right tabular-nums">
        {booking.originalTotalAmountCents != null
        && booking.originalTotalAmountCents > booking.totalAmountCents ? (
          <div className="flex flex-col items-end leading-tight">
            <span>{formatCents(booking.totalAmountCents)}</span>
            <span
              className="text-[10px] text-ink-soft line-through"
              title="Pre-discount price"
            >
              {formatCents(booking.originalTotalAmountCents)}
            </span>
          </div>
        ) : (
          formatCents(booking.totalAmountCents)
        )}
      </td>
      <td className="px-4 py-3">
        <StatusBadge status={booking.status} />
      </td>
    </tr>
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
