import type { PublicBooking } from "@/lib/publicApi";

export function TooClose({
  booking,
  returnUrl,
}: {
  booking: PublicBooking;
  returnUrl?: string | null;
}) {
  const mailto = booking.merchant.contactEmail
    ? `mailto:${booking.merchant.contactEmail}?subject=${encodeURIComponent(
        "Booking: " + booking.service.name,
      )}`
    : null;
  const { headline, body } = copyFor(booking);
  const merchantName = booking.merchant.businessName;

  return (
    <section className="mt-8 rounded-md border border-surface-border bg-white p-6 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-lavender-100 text-lavender-700">
        <CalendarAlertIcon />
      </div>
      <h2 className="mt-4 text-[16px] font-medium text-ink">{headline}</h2>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">
        {body} Reach out to {merchantName} directly to arrange payment.
      </p>
      {returnUrl ? (
        <div className="mt-5 flex flex-col items-center gap-3">
          <a
            href={returnUrl}
            className="inline-flex w-full max-w-xs items-center justify-center rounded-md bg-lavender-500 px-4 py-2.5 text-[13px] font-medium text-white no-underline hover:bg-lavender-600"
          >
            Return to {merchantName}
          </a>
          {mailto ? (
            <a
              href={mailto}
              className="text-[12px] text-ink-muted underline hover:text-ink"
            >
              Email {merchantName}
            </a>
          ) : null}
        </div>
      ) : mailto ? (
        <a
          href={mailto}
          className="mt-5 inline-flex items-center justify-center rounded-md bg-lavender-500 px-4 py-2.5 text-[13px] font-medium text-white no-underline hover:bg-lavender-600"
        >
          Email {merchantName}
        </a>
      ) : null}
    </section>
  );
}

function copyFor(booking: PublicBooking): { headline: string; body: string } {
  switch (booking.eligibility.reason) {
    case "too_close":
      return {
        headline: "This booking is too close for a payment plan",
        body: "Payment plans need a few weeks of runway to set up the schedule.",
      };
    case "too_far":
      return {
        headline: "This booking is too far out for a plan",
        body: "Plans are available for bookings within the merchant's preferred window.",
      };
    case "amount_too_low":
      return {
        headline: "This booking is below the plan minimum",
        body: "Payment plans are available on larger bookings only.",
      };
    case "amount_too_high":
      return {
        headline: "This booking is above the plan maximum",
        body: "Payment plans are not offered at this price point.",
      };
    case "no_plan_fits":
      return {
        headline: "No payment plan fits this booking",
        body: "There is not enough time to run a payment plan before this booking.",
      };
    case "deposit_too_high":
      return {
        headline: "A payment plan is not available for this booking",
        body: "The merchant's deposit configuration doesn't fit this booking size.",
      };
    default:
      return {
        headline: "A payment plan is not available for this booking",
        body: "",
      };
  }
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
