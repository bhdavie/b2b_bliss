import Link from "next/link";
import { OverviewConnections } from "@/components/merchant/OverviewConnections";
import { OnboardingChecklist } from "@/components/merchant/OnboardingChecklist";
import { Panel, SectionHeading } from "@/components/ui/primitives";
import {
  fetchAttentionPlansServer,
  fetchBookingsServer,
  fetchMerchantSession,
  fetchOnboardingServer,
} from "@/lib/auth";
import { formatCents, formatScheduleDate } from "@/lib/eligibility";
import type { Booking } from "@/lib/api";

export default async function HomePage() {
  const session = await fetchMerchantSession();
  if (!session) return null;
  const [list, attention, onboarding] = await Promise.all([
    fetchBookingsServer(),
    fetchAttentionPlansServer(),
    fetchOnboardingServer(),
  ]);
  const bookings = list?.bookings ?? [];
  const recent = bookings.slice(0, 4);
  const bookingsTotal = list?.total ?? bookings.length;
  const needsAttention = attention?.plans?.length ?? 0;
  const showChecklist = onboarding != null && !onboarding.complete;

  return (
    <div className="flex flex-col">
      {showChecklist ? (
        <div className="mb-3">
          <OnboardingChecklist status={onboarding} />
        </div>
      ) : null}

      {/* At a glance, promoted to a header rollup above the columns. The
          border-y band it used to sit in is gone: the fill separates it now. */}
      <Panel variant="filled" className="mb-3 gap-4 p-5">
        <SectionHeading>At a glance</SectionHeading>
        <div className="flex flex-wrap items-baseline gap-x-14 gap-y-4">
          <Stat value={String(bookingsTotal)} label="Bookings" />
          <Stat value={String(needsAttention)} label="Needs attention" />
        </div>
      </Panel>

      <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        {/* The section IS the filled block, heading included — the inner Panel
            it used to wrap is gone rather than nested. Bottom padding is pulled
            back to pb-2 because the last child (a row, or the View-all link)
            carries its own. */}
        <Panel variant="filled" className="px-5 pt-5 pb-1">
          <SectionHeading>Recent bookings</SectionHeading>
          {recent.length === 0 ? (
            <div className="flex flex-col items-start pb-4 pt-3">
              <div className="text-[15px] font-medium text-ink-900">
                No bookings yet
              </div>
              <p className="mt-1.5 text-[14px] text-ink-500">
                Create a booking to share a payment plan link with a guest.
              </p>
              <Link
                href="/bookings"
                className="mt-5 rounded-full bg-brand-violet px-[30px] py-4 text-[14px] tracking-[-0.01em] text-white no-underline transition-colors hover:bg-brand-violet-deep hover:no-underline"
              >
                New booking
              </Link>
            </div>
          ) : (
            <>
              {recent.map((b) => (
                <BookingRow key={b.id} booking={b} />
              ))}
              <Link
                href="/bookings"
                className="pb-3 pt-3 text-[14px] tracking-[-0.01em] text-brand-violet no-underline hover:underline"
              >
                View all bookings
              </Link>
            </>
          )}
        </Panel>

        <div className="flex flex-col gap-3">
          {/* OverviewConnections no longer draws its own panel; this one holds
              the heading and the rows together, the way Booking and Schedule do
              on the guest plan screen. Rows carry their own py-3, so the bottom
              padding comes back to pb-2. */}
          <Panel variant="filled" className="px-5 pt-5 pb-1">
            <SectionHeading>Connections</SectionHeading>
            <OverviewConnections
              pmsType={session.pmsType}
              mews={onboarding?.mews ?? null}
              cloudbeds={onboarding?.cloudbeds ?? null}
            />
          </Panel>
        </div>
      </div>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex items-baseline gap-3">
      <div className="text-[34px] font-medium tracking-[-0.03em] tabular-nums text-ink-900">
        {value}
      </div>
      <div className="text-[14px] text-ink-500">{label}</div>
    </div>
  );
}

function BookingRow({ booking }: { booking: Booking }) {
  return (
    <Link
      href={`/bookings/${booking.id}`}
      className="flex items-start justify-between gap-8 border-b border-sand-100 py-4 no-underline last:border-b-0 hover:no-underline"
    >
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="truncate text-[14px] tracking-[-0.005em] text-ink-900">
          {booking.serviceName}
        </div>
        <div className="text-[14px] text-ink-500">
          {booking.customerNameHint ?? "Guest pending"} ·{" "}
          {formatScheduleDate(booking.appointmentDate)}
        </div>
      </div>
      <div className="whitespace-nowrap text-[14px] tabular-nums text-ink-900">
        {formatCents(booking.totalAmountCents)}
      </div>
    </Link>
  );
}
