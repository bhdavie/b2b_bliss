import Link from "next/link";
import { OverviewConnections } from "@/components/merchant/OverviewConnections";
import { OnboardingChecklist } from "@/components/merchant/OnboardingChecklist";
import { PageHeader, Panel, SectionHeading } from "@/components/ui/primitives";
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
      <PageHeader
        title="Overview"
        subtitle={`A quick look at ${session.businessName || "your property"} today.`}
      />

      {showChecklist ? (
        <div className="mb-7">
          <OnboardingChecklist status={onboarding} />
        </div>
      ) : null}

      {/* At a glance, promoted to a header rollup above the columns. The
          border-y band it used to sit in is gone: the fill separates it now. */}
      <Panel variant="filled" className="mb-7 gap-5 px-7 py-[30px]">
        <SectionHeading track="0.08em">At a glance</SectionHeading>
        <div className="flex flex-wrap items-baseline gap-x-14 gap-y-4">
          <Stat value={String(bookingsTotal)} label="Bookings" />
          <Stat value={String(needsAttention)} label="Needs attention" />
        </div>
      </Panel>

      <div className="grid grid-cols-1 items-start gap-x-12 gap-y-7 xl:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        {/* The section IS the filled block, heading included — the inner Panel
            it used to wrap is gone rather than nested. Bottom padding is pulled
            back to pb-2 because the last child (a row, or the View-all link)
            carries its own. */}
        <Panel variant="filled" className="px-7 pb-2 pt-[30px]">
          <SectionHeading track="0.08em">Recent bookings</SectionHeading>
          {recent.length === 0 ? (
            <div className="flex flex-col items-start pb-7 pt-5">
              <div className="text-xl font-medium tracking-[-0.015em] text-ink-900">
                No bookings yet
              </div>
              <p className="mt-1.5 text-base text-ink-400">
                Create a booking to share a payment plan link with a guest.
              </p>
              <Link
                href="/bookings"
                className="mt-5 rounded-full bg-brand-violet px-[30px] py-4 text-base font-medium tracking-[-0.01em] text-white no-underline transition-colors hover:bg-brand-violet-deep hover:no-underline"
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
                className="pb-6 pt-[22px] text-[17px] font-medium tracking-[-0.01em] text-brand-violet no-underline hover:underline"
              >
                View all bookings
              </Link>
            </>
          )}
        </Panel>

        <div className="flex flex-col gap-7">
          {/* OverviewConnections no longer draws its own panel; this one holds
              the heading and the rows together, the way Booking and Schedule do
              on the guest plan screen. Rows carry their own py-6, so the bottom
              padding comes back to pb-2. */}
          <Panel variant="filled" className="px-7 pb-2 pt-[30px]">
            <SectionHeading track="0.08em">Connections</SectionHeading>
            <OverviewConnections
              pmsType={session.pmsType}
              onboardingState={session.onboardingState}
              mews={onboarding?.mews ?? null}
              cloudbeds={onboarding?.cloudbeds ?? null}
              stripeConnectStatus={session.stripeConnectStatus}
            />
          </Panel>

          <Panel variant="filled" className="px-7 py-[30px]">
            <SectionHeading track="0.08em" className="mb-5">
              Next payout
            </SectionHeading>
            <p className="text-[17px] leading-[1.5] text-ink-500">
              No payouts scheduled yet. Payouts appear here once a plan
              completes.
            </p>
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
      <div className="text-[17px] text-ink-500">{label}</div>
    </div>
  );
}

function BookingRow({ booking }: { booking: Booking }) {
  return (
    <Link
      href={`/bookings/${booking.id}`}
      className="flex items-start justify-between gap-8 border-b border-sand-100 py-6 no-underline last:border-b-0 hover:no-underline"
    >
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="truncate text-xl font-medium tracking-[-0.015em] text-ink-900">
          {booking.serviceName}
        </div>
        <div className="text-base text-ink-400">
          {booking.customerNameHint ?? "Guest pending"} ·{" "}
          {formatScheduleDate(booking.appointmentDate)}
        </div>
      </div>
      <div className="whitespace-nowrap text-xl font-medium tracking-[-0.02em] tabular-nums text-ink-900">
        {formatCents(booking.totalAmountCents)}
      </div>
    </Link>
  );
}
