"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatCents } from "@/lib/eligibility";
import type { Booking, DerivedBookingStatus } from "@/lib/api";

type StatusFilter = "all" | DerivedBookingStatus;
type DateFilter = "all" | "7d" | "30d" | "month";

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "active", label: "Active" },
  { value: "late", label: "Late" },
  { value: "payments_complete", label: "Payments complete" },
  { value: "trip_complete", label: "Trip complete" },
  { value: "cancelled", label: "Cancelled" },
  { value: "other", label: "Other" },
];

const DATE_OPTIONS: { value: DateFilter; label: string }[] = [
  { value: "all", label: "All time" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "month", label: "This month" },
];

// Status badge styling — Bliss palette only (navy / purple / lavender / cream /
// dusty / neutral). Each state is visually distinct: active = solid lavender,
// late = warm cream "attention", payments complete = soft purple (done, not
// closed), trip complete = solid navy (closed/terminal), cancelled/other = muted.
const STATUS_BADGE: Record<DerivedBookingStatus, { label: string; className: string; dot: string }> = {
  active: { label: "Active", className: "bg-brand-lavender text-white", dot: "bg-white" },
  late: {
    label: "Late",
    className: "bg-brand-cream text-brand-navy ring-1 ring-inset ring-brand-dusty",
    dot: "bg-brand-purple",
  },
  payments_complete: {
    label: "Payments complete",
    className: "bg-brand-lavender/25 text-brand-purple ring-1 ring-inset ring-brand-purple/30",
    dot: "bg-brand-purple",
  },
  trip_complete: { label: "Trip complete", className: "bg-brand-navy text-white", dot: "bg-white" },
  cancelled: { label: "Cancelled", className: "bg-brand-neutral/50 text-ink-muted", dot: "bg-ink-muted" },
  other: { label: "Other", className: "bg-brand-neutral/25 text-ink-muted", dot: "bg-ink-muted" },
};

export function BookingsTable({ bookings }: { bookings: Booking[] }) {
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
  }, [sorted, search, status, dateRange]);

  return (
    <div className="mt-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-navy/40" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search guest or package"
            className="w-full rounded-md border border-brand-neutral bg-white py-2 pl-9 pr-3 text-sm text-ink placeholder:text-brand-navy/40 focus:border-brand-purple focus:outline-none focus:ring-2 focus:ring-brand-lavender/50"
          />
        </div>
        <Select value={status} onChange={(v) => setStatus(v as StatusFilter)} options={STATUS_OPTIONS} />
        <Select value={dateRange} onChange={(v) => setDateRange(v as DateFilter)} options={DATE_OPTIONS} />
      </div>

      <div className="mt-4 overflow-x-auto border border-brand-neutral">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-brand-cream/70 text-left">
              <Th>Booking package</Th>
              <Th>Guest</Th>
              <Th>Booking date</Th>
              <Th className="text-right">Total</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((b) => (
              <BookingRow key={b.id} booking={b} />
            ))}
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-sm text-brand-navy/55">
                  No bookings match these filters. Clear the search or filters to see them all.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BookingRow({ booking }: { booking: Booking }) {
  const badge = STATUS_BADGE[booking.derivedStatus ?? "other"];
  return (
    <tr className="border-t border-brand-neutral transition-colors hover:bg-brand-cream/40">
      <td className="px-4 py-3.5">
        <Link
          href={`/bookings/${booking.id}`}
          className="font-medium text-ink hover:text-brand-purple hover:underline"
        >
          {booking.serviceName}
        </Link>
      </td>
      <td className="px-4 py-3.5 text-ink">
        {booking.customerNameHint ?? booking.customerEmailHint ?? (
          <span className="text-brand-navy/40">—</span>
        )}
      </td>
      <td className="px-4 py-3.5 text-ink tabular-nums">{formatBookingDate(booking.createdAt)}</td>
      <td className="px-4 py-3.5 text-right tabular-nums text-ink">
        {booking.originalTotalAmountCents != null &&
        booking.originalTotalAmountCents > booking.totalAmountCents ? (
          <div className="flex flex-col items-end leading-tight">
            <span className="font-medium">{formatCents(booking.totalAmountCents)}</span>
            <span className="text-[10px] text-brand-navy/45 line-through">
              {formatCents(booking.originalTotalAmountCents)}
            </span>
          </div>
        ) : (
          <span className="font-medium">{formatCents(booking.totalAmountCents)}</span>
        )}
      </td>
      <td className="px-4 py-3.5">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${badge.className}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${badge.dot}`} aria-hidden="true" />
          {badge.label}
        </span>
      </td>
    </tr>
  );
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={`px-4 py-3 text-[13px] font-bold uppercase tracking-wide text-brand-navy ${className}`}
    >
      {children}
    </th>
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
      className="rounded-md border border-brand-neutral bg-white px-3 py-2 text-sm text-ink focus:border-brand-purple focus:outline-none focus:ring-2 focus:ring-brand-lavender/50"
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
