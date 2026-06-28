import Link from "next/link";
import { ConnectionGlance } from "@/components/merchant/ConnectionGlance";
import {
  fetchAttentionPlansServer,
  fetchBookingsServer,
  fetchMerchantSession,
} from "@/lib/auth";
import { formatCents, formatScheduleDate } from "@/lib/eligibility";
import type { Booking } from "@/lib/api";

export default async function HomePage() {
  const session = await fetchMerchantSession();
  if (!session) return null;
  const [list, attention] = await Promise.all([
    fetchBookingsServer(),
    fetchAttentionPlansServer(),
  ]);
  const bookings = list?.bookings ?? [];
  const recent = bookings.slice(0, 4);
  const bookingsTotal = list?.total ?? bookings.length;
  const needsAttention = attention?.plans?.length ?? 0;

  return (
    <>
      <header>
        <h1 className="text-3xl font-bold text-brand-navy">Overview</h1>
        <p className="mt-1 text-brand-navy/70">
          A quick look at {session.businessName || "your property"} today.
        </p>
      </header>

      <div className="mt-8 grid gap-10 lg:grid-cols-[1.5fr_1fr]">
        <section>
          <SectionLabel>Recent bookings</SectionLabel>
          {recent.length === 0 ? (
            <div className="mt-3 border-y border-brand-neutral py-8">
              <div className="text-sm font-medium text-brand-navy">No bookings yet</div>
              <p className="mt-1 text-sm text-brand-navy/60">
                Create a booking to share a payment plan link with a guest.
              </p>
              <Link href="/bookings" className="btn-primary-merchant mt-4">
                New booking
              </Link>
            </div>
          ) : (
            <>
              <ul className="mt-3 border-y border-brand-neutral">
                {recent.map((b, i) => (
                  <BookingRow key={b.id} booking={b} first={i === 0} />
                ))}
              </ul>
              <Link
                href="/bookings"
                className="mt-3 inline-block text-sm font-medium text-brand-purple hover:underline"
              >
                View all bookings
              </Link>
            </>
          )}
        </section>

        <div className="space-y-10">
          <section>
            <SectionLabel>Connections</SectionLabel>
            <div className="mt-3">
              <ConnectionGlance />
            </div>
          </section>

          <section>
            <SectionLabel>At a glance</SectionLabel>
            <div className="mt-3 grid grid-cols-2 gap-6">
              <Stat label="Bookings" value={String(bookingsTotal)} />
              <Stat label="Needs attention" value={String(needsAttention)} />
            </div>
          </section>

          <section>
            <SectionLabel>Next payout</SectionLabel>
            <p className="mt-3 text-sm text-brand-navy/60">
              No payouts scheduled yet. Payouts appear here once a plan completes.
            </p>
          </section>
        </div>
      </div>
    </>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-semibold uppercase tracking-wide text-brand-navy/55">
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-3xl font-bold tabular-nums text-ink">{value}</div>
      <div className="mt-0.5 text-xs text-brand-navy/60">{label}</div>
    </div>
  );
}

function BookingRow({ booking, first }: { booking: Booking; first: boolean }) {
  return (
    <li className={first ? "" : "border-t border-brand-neutral"}>
      <Link
        href={`/bookings/${booking.id}`}
        className="flex items-center justify-between gap-4 py-3"
      >
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-ink">{booking.serviceName}</div>
          <div className="mt-0.5 text-xs text-brand-navy/60">
            {booking.customerNameHint ?? "Guest pending"} · {formatScheduleDate(booking.appointmentDate)}
          </div>
        </div>
        <div className="shrink-0 text-sm font-medium tabular-nums text-ink">
          {formatCents(booking.totalAmountCents)}
        </div>
      </Link>
    </li>
  );
}
