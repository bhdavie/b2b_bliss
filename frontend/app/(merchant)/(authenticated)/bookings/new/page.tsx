import Link from "next/link";
import { redirect } from "next/navigation";
import { NewBookingForm } from "@/components/merchant/NewBookingForm";
import { fetchStripeStatusServer } from "@/lib/auth";

export default async function NewBookingPage() {
  const stripeStatus = await fetchStripeStatusServer();
  const chargesEnabled = stripeStatus?.status === "charges_enabled";
  // In dev mode Stripe is not yet wired; the backend allows booking creation
  // when STRIPE_SECRET_KEY is not configured. Mirror that here so the form is
  // reachable without a connected account during development.
  const allowDev = stripeStatus?.configured === false;

  if (!chargesEnabled && !allowDev) {
    redirect("/bookings");
  }

  return (
    <>
      <header className="flex items-start justify-between gap-4">
        <div>
          <Link
            href="/bookings"
            className="text-xs text-ink-muted hover:underline"
          >
            ← Back to bookings
          </Link>
          <h1 className="mt-2 text-2xl font-medium">New booking</h1>
          <p className="mt-1 text-ink-muted">
            Set the service, total, and date. We will derive the plan options
            automatically based on how far out the appointment is.
          </p>
        </div>
      </header>

      {allowDev && !chargesEnabled ? (
        <div className="mt-6 rounded-md bg-amber-50 border border-amber-200 px-4 py-3 text-xs text-amber-800">
          Stripe is not configured on the backend yet, so this booking will be
          stored locally but cannot accept real payments until Stripe is wired
          up.
        </div>
      ) : null}

      <NewBookingForm />
    </>
  );
}
