import { BookingsTable } from "@/components/merchant/BookingsTable";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/primitives";
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
      <header className="mb-9 flex items-start justify-between gap-10">
        <div className="flex flex-col gap-3">
          <h1 className="text-[44px] font-medium leading-[1.05] tracking-[-0.035em] text-ink-900">
            Bookings
          </h1>
          <p className="text-[19px] text-ink-500">
            Every plan you&apos;ve created and where it stands today.
          </p>
        </div>
        <Button
          href="/bookings/new"
          variant="primary"
          aria-disabled={!canCreate}
          className={canCreate ? "flex-none" : "flex-none pointer-events-none opacity-50"}
          title={canCreate ? undefined : "Finish setup before creating bookings"}
        >
          New booking
        </Button>
      </header>

      {bookings.length === 0 ? (
        <Panel variant="filled" className="items-center px-10 py-16 text-center">
          <div className="text-[22px] font-medium tracking-[-0.015em] text-ink-900">
            No bookings yet
          </div>
          <p className="mt-2.5 max-w-[420px] text-[17px] text-ink-500">
            Create your first booking to generate a shareable payment plan link.
            It&apos;ll show up here with its live status.
          </p>
          <Button
            href="/bookings/new"
            variant="primary"
            className="mt-6 inline-flex"
          >
            New booking
          </Button>
        </Panel>
      ) : (
        <BookingsTable bookings={bookings} />
      )}
    </>
  );
}
