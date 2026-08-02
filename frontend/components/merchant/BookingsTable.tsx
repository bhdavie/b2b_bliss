"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatCents } from "@/lib/eligibility";
import { Panel } from "@/components/ui/primitives";
import type { Booking, DerivedBookingStatus } from "@/lib/api";

type StatusFilter = "all" | DerivedBookingStatus;
type DateFilter = "all" | "7d" | "30d" | "month";

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "active", label: "Active" },
  { value: "late", label: "Late" },
  { value: "payments_complete", label: "Payments complete" },
  { value: "booking_complete", label: "Booking complete" },
  { value: "cancelled", label: "Cancelled" },
  { value: "other", label: "Other" },
];

const DATE_OPTIONS: { value: DateFilter; label: string }[] = [
  { value: "all", label: "All time" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "month", label: "This month" },
];

/**
 * Status hierarchy from turn 10a: Late is the loudest thing on the screen, in
 * near-black; Active is a violet-tint pill; everything terminal or neutral is
 * plain muted text with a grey dot. The export draws only Late, Active, Other
 * and Payments complete, so the three remaining statuses take the plain
 * treatment their siblings use rather than inventing a fourth.
 */
const STATUS_BADGE: Record<DerivedBookingStatus, { label: string; className: string; dot: string }> = {
  active: {
    label: "Active",
    className: "bg-brand-violet-tint text-brand-violet",
    dot: "bg-brand-violet",
  },
  late: {
    label: "Late",
    className: "bg-ink-900 text-white",
    dot: "bg-brand-lavender",
  },
  payments_complete: {
    label: "Payments complete",
    className: "text-ink-400",
    dot: "bg-sand-500",
  },
  booking_complete: {
    label: "Booking complete",
    className: "text-ink-400",
    dot: "bg-sand-500",
  },
  cancelled: { label: "Cancelled", className: "text-ink-400", dot: "bg-sand-500" },
  other: { label: "Other", className: "text-ink-400", dot: "bg-sand-500" },
};

// Tab membership is driven entirely by the live derived status — no stored
// field — so a status change (e.g. a manager cancels, or a check-in passes)
// moves a booking between tabs automatically. Active = in-progress; Archive =
// terminal. "other" (rare: no plan yet) stays in Active since it isn't terminal.
type Tab = "active" | "archive";
const ARCHIVE_STATUSES = new Set<DerivedBookingStatus>(["cancelled", "booking_complete"]);
function tabFor(status: DerivedBookingStatus): Tab {
  return ARCHIVE_STATUSES.has(status) ? "archive" : "active";
}

export function BookingsTable({ bookings }: { bookings: Booking[] }) {
  const [tab, setTab] = useState<Tab>("active");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [dateRange, setDateRange] = useState<DateFilter>("all");

  // Newest first, by booking date.
  const sorted = useMemo(
    () =>
      [...bookings].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    [bookings],
  );

  const counts = useMemo(() => {
    let active = 0;
    let archive = 0;
    for (const b of sorted) {
      if (tabFor(b.derivedStatus ?? "other") === "archive") archive += 1;
      else active += 1;
    }
    return { active, archive };
  }, [sorted]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const now = new Date();
    const cutoff =
      dateRange === "7d"
        ? daysAgo(now, 7)
        : dateRange === "30d"
          ? daysAgo(now, 30)
          : null;
    return sorted.filter((b) => {
      // Scope to the current tab first (derived-status driven), then the filters.
      if (tabFor(b.derivedStatus ?? "other") !== tab) return false;
      if (status !== "all" && (b.derivedStatus ?? "other") !== status) return false;
      if (q) {
        const hay = `${b.serviceName} ${b.customerNameHint ?? ""} ${b.customerEmailHint ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (dateRange !== "all") {
        const created = new Date(b.createdAt);
        if (dateRange === "month") {
          if (
            created.getFullYear() !== now.getFullYear() ||
            created.getMonth() !== now.getMonth()
          ) {
            return false;
          }
        } else if (cutoff && created < cutoff) {
          return false;
        }
      }
      return true;
    });
  }, [sorted, tab, search, status, dateRange]);

  return (
    <div>
      <div className="mb-7 inline-flex gap-1.5 self-start rounded-full bg-[#F4F2EF] p-[5px]">
        <TabButton active={tab === "active"} onClick={() => setTab("active")} count={counts.active}>
          Active
        </TabButton>
        <TabButton active={tab === "archive"} onClick={() => setTab("archive")} count={counts.archive}>
          Archive
        </TabButton>
      </div>

      <div className="mb-8 grid grid-cols-1 gap-5 sm:grid-cols-[minmax(0,1fr)_240px_200px]">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-[17px] top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search guest or package"
            className="w-full rounded-xl border-2 border-sand-500 bg-white py-[15px] pl-[45px] pr-[17px] text-[17px] text-ink-900 placeholder:text-ink-300 focus:border-brand-violet focus:outline-none focus:shadow-[0_0_0_4px_rgba(90,27,181,0.10)]"
          />
        </div>
        <Select value={status} onChange={(v) => setStatus(v as StatusFilter)} options={STATUS_OPTIONS} />
        <Select value={dateRange} onChange={(v) => setDateRange(v as DateFilter)} options={DATE_OPTIONS} />
      </div>

      <Panel className="overflow-hidden">
        <div className="overflow-x-auto">
          <div className="min-w-[860px]">
            <div className="grid grid-cols-[minmax(0,1fr)_140px_125px_115px_170px] gap-x-4 border-b border-sand-200 bg-sand-50 px-8 py-[18px]">
              <Th>Booking package</Th>
              <Th>Guest</Th>
              <Th>Booking date</Th>
              <Th className="text-right">Total</Th>
              <Th>Status</Th>
            </div>
            {filtered.map((b) => (
              <BookingRow key={b.id} booking={b} />
            ))}
            {filtered.length === 0 ? (
              <div className="px-8 py-16 text-center text-[17px] text-ink-400">
                {tab === "active"
                  ? "No active bookings match these filters."
                  : "Nothing in the archive yet. Cancelled and completed bookings land here."}
              </div>
            ) : null}
          </div>
        </div>
      </Panel>
    </div>
  );
}

function BookingRow({ booking }: { booking: Booking }) {
  const status = booking.derivedStatus ?? "other";
  const badge = STATUS_BADGE[status];
  const plain = status !== "active" && status !== "late";
  return (
    <Link
      href={`/bookings/${booking.id}`}
      className="grid grid-cols-[minmax(0,1fr)_140px_125px_115px_170px] items-center gap-x-4 border-b border-sand-100 px-8 py-[22px] no-underline transition-colors last:border-b-0 hover:bg-sand-50 hover:no-underline"
    >
      <div className="truncate text-[17px] font-medium tracking-[-0.012em] text-ink-900">
        {booking.serviceName}
      </div>
      <div className="truncate text-[17px] text-ink-700">
        {booking.customerNameHint ?? booking.customerEmailHint ?? (
          <span className="text-ink-300">-</span>
        )}
      </div>
      <div className="text-[17px] text-ink-500">
        {formatBookingDate(booking.createdAt)}
      </div>
      <div className="text-right text-lg font-medium tabular-nums text-ink-900">
        {booking.originalTotalAmountCents != null &&
        booking.originalTotalAmountCents > booking.totalAmountCents ? (
          <div className="flex flex-col items-end leading-tight">
            <span>{formatCents(booking.totalAmountCents)}</span>
            <span className="text-[13px] text-ink-400 line-through">
              {formatCents(booking.originalTotalAmountCents)}
            </span>
          </div>
        ) : (
          <span>{formatCents(booking.totalAmountCents)}</span>
        )}
      </div>
      <div>
        <span
          className={`inline-flex items-center gap-2 text-[15px] font-medium ${
            plain ? "" : "rounded-full px-[15px] py-[7px]"
          } ${badge.className}`}
        >
          <span
            className={`h-1.5 w-1.5 flex-none rounded-full ${badge.dot}`}
            aria-hidden="true"
          />
          {badge.label}
        </span>
      </div>
    </Link>
  );
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`whitespace-nowrap text-xs uppercase tracking-[0.08em] text-ink-400 ${className}`}
    >
      {children}
    </div>
  );
}

function TabButton({
  active,
  count,
  onClick,
  children,
}: {
  active: boolean;
  count: number;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-[9px] rounded-full px-5 py-[11px] text-base tracking-[-0.01em] transition-colors ${
        active
          ? "bg-brand-violet font-medium text-white"
          : "text-ink-600 hover:text-ink-900"
      }`}
    >
      {children}
      <span
        className={`rounded-full px-[9px] py-0.5 text-sm tabular-nums ${
          active ? "bg-white/[.22] text-white" : "bg-[#E6E2DD] text-ink-600"
        }`}
      >
        {count}
      </span>
    </button>
  );
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-xl border border-sand-500 bg-white px-[18px] py-4 text-[17px] text-ink-900 focus:border-brand-violet focus:outline-none focus:shadow-[0_0_0_4px_rgba(90,27,181,0.10)]"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function SearchIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.2-3.2" strokeLinecap="round" />
    </svg>
  );
}

function daysAgo(now: Date, n: number): Date {
  const d = new Date(now);
  d.setDate(d.getDate() - n);
  return d;
}

function formatBookingDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
