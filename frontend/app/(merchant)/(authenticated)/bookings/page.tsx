import Link from "next/link";
import { fetchStripeStatusServer } from "@/lib/auth";

export default async function BookingsPage() {
  const stripeStatus = await fetchStripeStatusServer();
  const chargesEnabled = stripeStatus?.status === "charges_enabled";

  return (
    <>
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-medium">Bookings</h1>
          <p className="mt-1 text-ink-muted">
            Create a booking and share the payment plan link with your customer.
          </p>
        </div>
        <button
          type="button"
          className="btn-primary"
          disabled={!chargesEnabled}
          title={
            chargesEnabled
              ? undefined
              : "Finish Stripe setup before creating bookings"
          }
        >
          New booking
        </button>
      </header>

      {chargesEnabled ? (
        <div className="mt-8 card p-10 text-center">
          <div className="text-sm font-medium">No bookings yet</div>
          <p className="mt-1 text-ink-muted text-sm">
            Booking creation flow lands in the next phase of the build.
          </p>
        </div>
      ) : (
        <div className="mt-8 card p-10 text-center">
          <div className="text-sm font-medium">
            Connect Stripe before you can create a booking
          </div>
          <p className="mt-2 text-ink-muted text-sm">
            Bliss collects customer payments and routes them to your bank
            account through Stripe Connect.
          </p>
          <Link href="/settings" className="mt-4 inline-block btn-primary">
            Go to payouts
          </Link>
        </div>
      )}
    </>
  );
}
