import Link from "next/link";
import { Panel, SectionHeading } from "@/components/ui/primitives";
import { fetchAdminMerchants } from "@/lib/auth";
import {
  formatDate,
  formatFeeRate,
  humanize,
  propertyName,
} from "@/lib/adminFormat";
import type { AdminMerchantRow } from "@/lib/api";

// Column widths are shared by the header and the rows, declared once so the two
// cannot drift. Same full-bleed table shape the merchant bookings list uses:
// the card owns the 20px padding and the rows bleed back out through -mx-5.
const COLS =
  "grid grid-cols-[minmax(0,1fr)_110px_140px_120px_90px_100px] gap-x-4 px-5";

export default async function AdminPropertiesPage() {
  // null means the admin session expired between the layout's check and this
  // fetch. The layout already redirected in the normal case, so an empty list
  // is the honest thing to render rather than a crash.
  const merchants = (await fetchAdminMerchants()) ?? [];

  return (
    <Panel variant="filled" className="overflow-hidden p-5">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
        <SectionHeading>Properties</SectionHeading>
        <span className="text-[13px] text-ink-500">
          {merchants.length} {merchants.length === 1 ? "property" : "properties"}
        </span>
      </div>

      <div className="-mx-5 overflow-x-auto">
        <div className="min-w-[860px]">
          <div
            className={`${COLS} border-y border-sand-200 bg-sand-50 py-4`}
          >
            <Th>Property</Th>
            <Th>Status</Th>
            <Th>Onboarding</Th>
            <Th>Joined</Th>
            <Th className="text-right">7d bookings</Th>
            <Th className="text-right">Fee rate</Th>
          </div>

          {merchants.map((m) => (
            <PropertyRow key={m.id} merchant={m} />
          ))}

          {merchants.length === 0 ? (
            <div className="px-5 py-10 text-center text-[14px] text-ink-500">
              No properties yet.
            </div>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}

function PropertyRow({ merchant }: { merchant: AdminMerchantRow }) {
  // The whole row is the link, not just the name, so the click target is the
  // row the eye is already on. Same treatment as the merchant bookings table.
  return (
    <Link
      href={`/admin/properties/${merchant.id}`}
      className={`${COLS} items-center border-b border-sand-100 py-4 no-underline transition-colors last:border-b-0 hover:bg-sand-50 hover:no-underline`}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-[14px] text-ink-900">
          {propertyName(merchant)}
          {merchant.isDemo ? (
            <span className="ml-2 text-[13px] text-ink-500">demo</span>
          ) : null}
        </span>
        <span className="truncate text-[13px] text-ink-500">
          {merchant.email}
        </span>
      </div>
      {/* Status and onboarding are plain text, not badges: this is internal
          tooling and a new colour per state would add a palette nobody needs
          to read a nine-row table. */}
      <span className="text-[13px] text-ink-500">{humanize(merchant.status)}</span>
      <span className="text-[13px] text-ink-500">
        {humanize(merchant.onboardingState)}
      </span>
      <span className="text-[13px] text-ink-500">
        {formatDate(merchant.createdAt)}
      </span>
      <span className="text-right text-[14px] tabular-nums text-ink-900">
        {merchant.bookingsLast7Days}
      </span>
      <span className="text-right text-[14px] tabular-nums text-ink-900">
        {formatFeeRate(merchant.currentFeeRate)}
      </span>
    </Link>
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
