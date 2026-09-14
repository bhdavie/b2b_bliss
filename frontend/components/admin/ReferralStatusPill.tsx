import type { AdminReferralStatus } from "@/lib/api";

/**
 * Referral status, drawn with the bookings table's two treatments and nothing
 * new. Statuses still waiting on someone take the violet-tint pill Active uses;
 * the two terminal ones take the plain muted text with a grey dot that
 * Cancelled and Booking complete use. The near-black Late pill is left alone:
 * it means something has gone wrong, and no referral status does.
 */
const STATUS_BADGE: Record<
  AdminReferralStatus,
  { label: string; className: string; dot: string; plain: boolean }
> = {
  submitted: {
    label: "Submitted",
    className: "bg-brand-violet-tint text-brand-violet",
    dot: "bg-brand-violet",
    plain: false,
  },
  contacted: {
    label: "Contacted",
    className: "bg-brand-violet-tint text-brand-violet",
    dot: "bg-brand-violet",
    plain: false,
  },
  live: {
    label: "Live",
    className: "bg-brand-violet-tint text-brand-violet",
    dot: "bg-brand-violet",
    plain: false,
  },
  credited: {
    label: "Credited",
    className: "text-ink-500",
    dot: "bg-sand-600",
    plain: true,
  },
  declined: {
    label: "Declined",
    className: "text-ink-500",
    dot: "bg-sand-600",
    plain: true,
  },
};

export function referralStatusLabel(status: AdminReferralStatus): string {
  return STATUS_BADGE[status].label;
}

export function ReferralStatusPill({ status }: { status: AdminReferralStatus }) {
  const badge = STATUS_BADGE[status];
  return (
    <span
      className={`inline-flex items-center gap-2 text-[13px] ${
        badge.plain ? "" : "rounded-full px-[15px] py-[7px]"
      } ${badge.className}`}
    >
      <span
        className={`h-1.5 w-1.5 flex-none rounded-full ${badge.dot}`}
        aria-hidden="true"
      />
      {badge.label}
    </span>
  );
}
