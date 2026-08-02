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
        <div className="mb-14">
          <OnboardingChecklist status={onboarding} />
        </div>
      ) : null}

      {/* At a glance, promoted to a header rollup above the columns. */}
      <div className="mb-14 flex flex-col gap-4 border-y border-sand-300 pb-7 pt-[26px]">
        <SectionHeading track="0.08em">At a glance</SectionHeading>
        <div className="flex flex-wrap items-baseline gap-x-14 gap-y-4">
          <Stat value={String(bookingsTotal)} label="Bookings" />
          <Stat value={String(needsAttention)} label="Needs attention" />
        </div>
      </div>

      <div className="grid grid-cols-1 items-start gap-x-12 gap-y-12 xl:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        <section className="flex flex-col">
          <SectionHeading track="0.08em" className="mb-5">
            Recent bookings
          </SectionHeading>
          {recent.length === 0 ? (
            <Panel className="items-start px-8 py-10">
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
            </Panel>
          ) : (
            <Panel className="px-8 py-2">
              {recent.map((b) => (
                <BookingRow key={b.id} booking={b} />
              ))}
              <Link
                href="/bookings"
                className="pb-6 pt-[22px] text-[17px] font-medium tracking-[-0.01em] text-brand-violet no-underline hover:underline"
              >
                View all bookings
              </Link>
            </Panel>
          )}
        </section>

        <div className="flex flex-col gap-10">
          <section className="flex flex-col">
            <SectionHeading track="0.08em" className="mb-5">
              Connections
            </SectionHeading>
            <OverviewConnections
              pmsType={session.pmsType}
              onboardingState={session.onboardingState}
              mews={onboarding?.mews ?? null}
              cloudbeds={onboarding?.cloudbeds ?? null}
              stripeConnectStatus={session.stripeConnectStatus}
            />
          </section>

          <section className="flex flex-col">
            <SectionHeading track="0.08em" className="mb-5">
              Next payout
            </SectionHeading>
            <Panel className="bg-sand-50 px-7 pb-[30px] pt-7">
              <p className="text-[17px] leading-[1.5] text-ink-500">
                No payouts scheduled yet. Payouts appear here once a plan
                completes.
              </p>
            </Panel>
          </section>
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
