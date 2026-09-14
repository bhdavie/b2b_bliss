import Link from "next/link";
import { ReferralStatusPill } from "@/components/admin/ReferralStatusPill";
import { Panel, SectionHeading } from "@/components/ui/primitives";
import { fetchAdminReferrals } from "@/lib/auth";
import { formatDate } from "@/lib/adminFormat";
import {
  isAdminReferralStatus,
  type AdminReferral,
  type AdminReferralStatus,
} from "@/lib/api";

// Column widths are shared by the header and the rows, declared once so the two
// cannot drift. Same full-bleed table shape as the properties list.
const COLS =
  "grid grid-cols-[minmax(0,1fr)_160px_minmax(0,1fr)_150px_120px] gap-x-4 px-5";

const TABS: { value: AdminReferralStatus | null; label: string }[] = [
  { value: null, label: "All" },
  { value: "submitted", label: "Submitted" },
  { value: "contacted", label: "Contacted" },
  { value: "live", label: "Live" },
  { value: "credited", label: "Credited" },
  { value: "declined", label: "Declined" },
];

export default async function AdminReferralsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string | string[] }>;
}) {
  const { status: rawStatus } = await searchParams;
  // An unknown or repeated ?status= falls back to All rather than asking the
  // API a question it would answer with a 400.
  const status = isAdminReferralStatus(rawStatus) ? rawStatus : null;

  // null means the admin session expired between the layout's check and this
  // fetch. Same handling as the properties list.
  const referrals = (await fetchAdminReferrals(status)) ?? [];

  return (
    <Panel variant="filled" className="overflow-hidden p-5">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
        <SectionHeading>Referrals</SectionHeading>
        <span className="text-[13px] text-ink-500">
          {referrals.length} {referrals.length === 1 ? "referral" : "referrals"}
        </span>
      </div>

      {/* Filter tabs are links, not state: the list is a server component and
          the filter belongs in the URL so a filtered queue can be shared. Same
          track and active treatment as the bookings table tabs. */}
      <div className="mb-4 overflow-x-auto">
        <nav
          aria-label="Filter by status"
          className="inline-flex gap-1.5 rounded-full bg-sand-track p-[5px]"
        >
          {TABS.map((tab) => {
            const active = tab.value === status;
            return (
              <Link
                key={tab.label}
                href={tab.value ? `/admin/referrals?status=${tab.value}` : "/admin/referrals"}
                aria-current={active ? "page" : undefined}
                className={`inline-flex items-center whitespace-nowrap rounded-full px-5 py-[11px] text-[14px] tracking-[-0.01em] no-underline transition-colors hover:no-underline ${
                  active
                    ? "bg-brand-violet font-medium text-white"
                    : "text-ink-600 hover:text-ink-900"
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="-mx-5 overflow-x-auto">
        <div className="min-w-[860px]">
          <div className={`${COLS} border-y border-sand-200 bg-sand-50 py-4`}>
            <Th>Hotel</Th>
            <Th>City</Th>
            <Th>Guest</Th>
            <Th>Status</Th>
            <Th>Submitted</Th>
          </div>

          {referrals.map((r) => (
            <ReferralRow key={r.id} referral={r} />
          ))}

          {referrals.length === 0 ? (
            <div className="px-5 py-10 text-center text-[14px] text-ink-500">
              {status ? "No referrals with this status." : "No referrals yet."}
            </div>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}

function ReferralRow({ referral }: { referral: AdminReferral }) {
  // The whole row is the link, as on the properties list.
  return (
    <Link
      href={`/admin/referrals/${referral.id}`}
      className={`${COLS} items-center border-b border-sand-100 py-4 no-underline transition-colors last:border-b-0 hover:bg-sand-50 hover:no-underline`}
    >
      <span className="truncate text-[14px] text-ink-900">{referral.hotelName}</span>
      <span className="truncate text-[13px] text-ink-500">{referral.hotelCity}</span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-[14px] text-ink-900">
          {referral.guestName ?? referral.guestEmail}
        </span>
        {referral.guestName ? (
          <span className="truncate text-[13px] text-ink-500">
            {referral.guestEmail}
          </span>
        ) : null}
      </div>
      <div>
        <ReferralStatusPill status={referral.status} />
      </div>
      <span className="text-[13px] text-ink-500">{formatDate(referral.createdAt)}</span>
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
