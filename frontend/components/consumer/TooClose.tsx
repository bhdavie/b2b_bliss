import type { PublicBooking } from "@/lib/publicApi";

export function TooClose({ booking }: { booking: PublicBooking }) {
  const mailto = booking.merchant.contactEmail
    ? `mailto:${booking.merchant.contactEmail}?subject=${encodeURIComponent(
        "Booking: " + booking.service.name,
      )}`
    : null;

  return (
    <section className="mt-8 rounded-md border border-surface-border bg-white p-6 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-lavender-100 text-lavender-700">
        <CalendarAlertIcon />
      </div>
      <h2 className="mt-4 text-[16px] font-medium text-ink">
        This booking is too close for a payment plan
      </h2>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">
        Payment plans are available 6 weeks or more before the booking date.
        Reach out to {booking.merchant.businessName} directly to arrange
        payment.
      </p>
      {mailto ? (
        <a
          href={mailto}
          className="mt-5 inline-flex items-center justify-center rounded-md bg-lavender-500 px-4 py-2.5 text-[13px] font-medium text-white no-underline hover:bg-lavender-600"
        >
          Email {booking.merchant.businessName}
        </a>
      ) : null}
    </section>
  );
}

function CalendarAlertIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M16 3v4M8 3v4M3 11h18" />
      <path d="M12 14v3M12 19h.01" />
    </svg>
  );
}
