import Link from "next/link";
import { BookingsTable } from "@/components/merchant/BookingsTable";
import { fetchBookingsServer, fetchStripeStatusServer } from "@/lib/auth";

export default async function BookingsPage() {
  const [stripeStatus, list] = await Promise.all([
    fetchStripeStatusServer(),
    fetchBookingsServer(),
  ]);
  const chargesEnabled = stripeStatus?.status === "charges_enabled";
  const stripeUnconfigured = stripeStatus?.configured === false;
  const canCreate = chargesEnabled || stripeUnconfigured;
  const bookings = list?.bookings ?? [];

  return (
    <>
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-brand-navy">Bookings</h1>
          <p className="mt-1 text-brand-navy/70">
            Every plan you&apos;ve created and where it stands today.
          </p>
        </div>
        <Link
          href="/bookings/new"
          aria-disabled={!canCreate}
          className={`btn-primary-merchant ${canCreate ? "" : "pointer-events-none opacity-50"}`}
          title={canCreate ? undefined : "Finish setup before creating bookings"}
        >
          New booking
        </Link>
      </header>

      {bookings.length === 0 ? (
        <div className="mt-8 border border-brand-neutral bg-white p-12 text-center">
          <div className="text-sm font-semibold text-brand-navy">No bookings yet</div>
          <p className="mx-auto mt-1 max-w-sm text-sm text-brand-navy/60">
            Create your first booking to generate a shareable payment plan link.
            It&apos;ll show up here with its live status.
          </p>
          <Link href="/bookings/new" className="btn-primary-merchant mt-5 inline-flex">
            New booking
          </Link>
        </div>
      ) : (
        <BookingsTable bookings={bookings} />
      )}
    </>
  );
}
