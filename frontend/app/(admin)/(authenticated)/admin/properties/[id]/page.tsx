import Link from "next/link";
import { notFound } from "next/navigation";
import { FeeRateForm } from "@/components/admin/FeeRateForm";
import { Panel, RecordTitle, SectionHeading } from "@/components/ui/primitives";
import { fetchAdminMerchantDetail } from "@/lib/auth";
import { formatCents } from "@/lib/eligibility";
import {
  formatDate,
  formatDateTime,
  formatDerivedRate,
  formatFeeRate,
  formatPlainDate,
  humanize,
  propertyName,
} from "@/lib/adminFormat";
import type { AdminFeeRateRow, AdminRecentBooking } from "@/lib/api";

const BOOKING_COLS =
  "grid grid-cols-[minmax(0,1fr)_100px_110px_120px_110px_130px_90px_90px] gap-x-4 px-5";

export default async function AdminPropertyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await fetchAdminMerchantDetail(id);
  if (!detail) notFound();

  const { merchant, profile, feeRateHistory, counts, recentBookings } = detail;
  const address = [
    profile.addressLine1,
    profile.addressLine2,
    [profile.addressCity, profile.addressState, profile.addressZip]
      .filter(Boolean)
      .join(", "),
    profile.addressCountry,
  ]
    .filter(Boolean)
    .join("\n");

  // Which history row is in force right now: the newest whose effectiveFrom has
  // arrived. The list is already newest first, so the first past-dated row wins.
  // Computed here rather than asked of the API because the API already told us
  // the answer in currentFeeRate; this only marks WHICH row that is.
  const now = Date.now();
  const inForceId =
    feeRateHistory.find((r) => new Date(r.effectiveFrom).getTime() <= now)?.id ??
    null;

  return (
    <div className="flex flex-col gap-3">
      {/* Card 1 — identity */}
      <Panel variant="filled" className="p-5">
        <Link
          href="/admin"
          className="mb-4 self-start text-[15px] text-brand-violet no-underline hover:underline"
        >
          ← Back to properties
        </Link>
        <RecordTitle className="mb-1">{propertyName(merchant)}</RecordTitle>
        <p className="mb-4 text-[14px] text-ink-500">
          {merchant.slug}
          {merchant.isDemo ? " · demo account" : ""}
        </p>

        <div className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2 xl:grid-cols-3">
          <Field label="Email" value={merchant.email} />
          <Field label="Phone" value={profile.phone} />
          <Field label="Status" value={humanize(merchant.status)} />
          <Field
            label="Onboarding"
            value={humanize(merchant.onboardingState)}
          />
          <Field label="PMS" value={humanize(merchant.pmsType)} />
          <Field label="Demo" value={merchant.isDemo ? "Yes" : "No"} />
          <Field label="Joined" value={formatDate(merchant.createdAt)} />
          <Field
            label="Email verified"
            value={
              profile.emailVerifiedAt
                ? formatDateTime(profile.emailVerifiedAt)
                : "Not verified"
            }
          />
          <Field label="Address" value={address || null} multiline />
        </div>
      </Panel>

      {/* Card 2 — fee rate */}
      <Panel variant="filled" className="p-5">
        <SectionHeading className="mb-4">Fee rate</SectionHeading>

        <div className="mb-4 flex flex-wrap items-baseline gap-3">
          <span className="text-[28px] font-medium tracking-[-0.015em] text-ink-900">
            {formatFeeRate(merchant.currentFeeRate)}
          </span>
          <span className="text-[13px] text-ink-500">
            {merchant.currentFeeRate === null
              ? "No rate on record. New plans fall back to 5%."
              : "In force now. Applies to plans created from now on."}
          </span>
        </div>

        <div className="mb-4 h-px bg-sand-200" />

        <FeeRateForm merchantId={merchant.id} />

        <div className="my-4 h-px bg-sand-200" />

        <SectionHeading className="mb-4">Rate history</SectionHeading>
        {feeRateHistory.length === 0 ? (
          <p className="text-[14px] text-ink-500">No rates set yet.</p>
        ) : (
          <div className="flex flex-col">
            {feeRateHistory.map((row) => (
              <HistoryRow
                key={row.id}
                row={row}
                inForce={row.id === inForceId}
              />
            ))}
          </div>
        )}
      </Panel>

      {/* Card 3 — counts */}
      <Panel variant="filled" className="p-5">
        <SectionHeading className="mb-4">Counts</SectionHeading>
        <div className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
          <div className="flex flex-col">
            <Field
              label="Bookings"
              value={String(counts.bookingsTotal)}
            />
            <CountBreakdown counts={counts.bookingsByStatus} />
          </div>
          <div className="flex flex-col">
            <Field label="Plans" value={String(counts.plansTotal)} />
            <CountBreakdown counts={counts.plansByStatus} />
          </div>
        </div>
      </Panel>

      {/* Card 4 — recent bookings */}
      <Panel variant="filled" className="overflow-hidden p-5">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
          <SectionHeading>Recent bookings</SectionHeading>
          <span className="text-[13px] text-ink-500">
            {recentBookings.length} most recent
          </span>
        </div>
        <div className="-mx-5 overflow-x-auto">
          <div className="min-w-[1040px]">
            <div className={`${BOOKING_COLS} border-y border-sand-200 bg-sand-50 py-4`}>
              <Th>Service</Th>
              <Th className="text-right">Total</Th>
              <Th>Status</Th>
              <Th>Source</Th>
              <Th>Created</Th>
              <Th>Guest</Th>
              <Th className="text-right">Fee</Th>
              <Th className="text-right">Rate</Th>
            </div>
            {recentBookings.map((b) => (
              <BookingRow key={b.id} booking={b} />
            ))}
            {recentBookings.length === 0 ? (
              <div className="px-5 py-10 text-center text-[14px] text-ink-500">
                No bookings yet.
              </div>
            ) : null}
          </div>
        </div>
      </Panel>
    </div>
  );
}

function BookingRow({ booking }: { booking: AdminRecentBooking }) {
  return (
    <div
      className={`${BOOKING_COLS} items-start border-b border-sand-100 py-4 last:border-b-0`}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-[14px] text-ink-900">
          {booking.serviceName}
        </span>
        <span className="text-[13px] text-ink-500">
          Check-out {formatPlainDate(booking.checkoutDate)}
        </span>
      </div>
      <span className="text-right text-[14px] tabular-nums text-ink-900">
        {formatCents(booking.totalAmountCents)}
      </span>
      <div className="flex flex-col gap-0.5">
        <span className="text-[13px] text-ink-500">
          {humanize(booking.status)}
        </span>
        {/* Plan status sits under booking status: they are different states and
            a booking can exist with no plan at all. */}
        <span className="text-[13px] text-ink-500">
          {booking.planStatus
            ? `Plan: ${humanize(booking.planStatus)}`
            : "No plan"}
        </span>
      </div>
      <span className="text-[13px] text-ink-500">
        {humanize(booking.bookingSource)}
      </span>
      <span className="text-[13px] text-ink-500">
        {formatDate(booking.createdAt)}
      </span>
      <span className="truncate text-[13px] text-ink-500">
        {booking.customerNameHint ?? "–"}
      </span>
      <div className="flex flex-col items-end gap-0.5">
        <span className="text-[14px] tabular-nums text-ink-900">
          {booking.processingFeeCents === null
            ? "–"
            : formatCents(booking.processingFeeCents)}
        </span>
        <span className="text-[13px] text-ink-500">
          {booking.numPayments === null ? "–" : `${booking.numPayments}×`}
        </span>
      </div>
      {/* Straight from the API. A null means the backend could not recover the
          rate safely, so it is a dash and never a zero. */}
      <span className="text-right text-[14px] tabular-nums text-ink-900">
        {formatDerivedRate(booking.derivedFeeRate)}
      </span>
    </div>
  );
}

function HistoryRow({
  row,
  inForce,
}: {
  row: AdminFeeRateRow;
  inForce: boolean;
}) {
  const future = new Date(row.effectiveFrom).getTime() > Date.now();
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-sand-100 py-4 last:border-b-0">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[14px] text-ink-900">
          {formatFeeRate(row.rate)}
          {inForce ? (
            <span className="ml-2 text-[13px] text-brand-violet">
              in effect
            </span>
          ) : null}
          {future ? (
            <span className="ml-2 text-[13px] text-ink-500">scheduled</span>
          ) : null}
        </span>
        <span className="text-[13px] text-ink-500">
          {row.note ?? "No note"}
        </span>
      </div>
      <div className="flex flex-col items-end gap-0.5">
        <span className="text-[13px] text-ink-500">
          From {formatDateTime(row.effectiveFrom)}
        </span>
        <span className="text-[13px] text-ink-500">
          {row.createdByAdminEmail ?? "System"}
        </span>
      </div>
    </div>
  );
}

function CountBreakdown({ counts }: { counts: Record<string, number> }) {
  const entries = Object.entries(counts);
  if (entries.length === 0) {
    return <span className="mt-2 text-[13px] text-ink-500">None</span>;
  }
  return (
    <div className="mt-3 flex flex-col">
      {entries.map(([status, n]) => (
        <div
          key={status}
          className="flex items-baseline justify-between gap-6 border-b border-sand-100 py-3 last:border-b-0"
        >
          <span className="text-[13px] text-ink-500">{humanize(status)}</span>
          <span className="text-[14px] tabular-nums text-ink-900">{n}</span>
        </div>
      ))}
    </div>
  );
}

function Field({
  label,
  value,
  multiline = false,
}: {
  label: string;
  value: string | null;
  multiline?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[12px] uppercase tracking-[0.08em] text-ink-500">
        {label}
      </span>
      <span
        className={`text-[14px] text-ink-900 ${multiline ? "whitespace-pre-line" : ""}`}
      >
        {value && value.trim() ? value : "–"}
      </span>
    </div>
  );
}

function Th({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`whitespace-nowrap text-[12px] uppercase tracking-[0.08em] text-ink-500 ${className}`}
    >
      {children}
    </div>
  );
}
