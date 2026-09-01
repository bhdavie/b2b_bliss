import { BookingsTable } from "@/components/merchant/BookingsTable";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/primitives";
import { fetchBookingsServer, fetchOnboardingServer } from "@/lib/auth";

export default async function BookingsPage() {
  const [onboarding, list] = await Promise.all([
    fetchOnboardingServer(),
    fetchBookingsServer(),
  ]);
  // Gated on the PMS connection, not on Stripe charges_enabled. The old gate
  // asked whether the property could take a card on its own Stripe Connect
  // account; with the payment-processor step removed, no property can ever
  // answer yes to that, so it would have locked "New booking" for everyone.
  // What actually has to be true is that the rail which executes the charge is
  // connected, which is exactly the pms_connected step.
  const canCreate =
    onboarding?.steps.find((s) => s.key === "pms_connected")?.done ?? false;
  const bookings = list?.bookings ?? [];

  return (
    <>
      <header className="mb-9 flex items-start justify-between gap-10">
        <div className="flex flex-col gap-3">
          {/* Not PageHeader: this route needs the New booking button beside the
              title, which PageHeader has no slot for. The h1 therefore carries
              a copy of PageHeader's classes and has to be kept in step with it
              by hand — including the serif face and the font-normal that goes
              with it. See the note in PageHeader for why the weight drops. */}
          <h1 className="font-display text-[44px] font-normal leading-[1.05] tracking-[-0.035em] text-brand-violet">
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
