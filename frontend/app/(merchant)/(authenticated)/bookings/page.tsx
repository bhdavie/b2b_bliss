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
  // Mews properties take plans through their booking engine: the guest picks a
  // room there and Bliss creates the Mews reservation. A dashboard link has no
  // room to reserve, so the backend refuses it and the button is not offered.
  const isMews = onboarding?.pmsType === "mews";

  if (isMews) {
    return (
      <>
        <Panel variant="filled" className="mb-3 px-5 py-5">
          <div className="text-[15px] font-medium text-ink-900">
            Your guests book through Mews
          </div>
          <p className="mt-2 max-w-[560px] text-[14px] text-ink-500">
            Guests choose a payment plan in your Mews booking engine, and Bliss creates the
            reservation in Mews for you. Payment plan links aren&apos;t created from the
            dashboard for Mews properties. Plans your guests start show up below.
          </p>
          <Button href="/install" variant="ghost" className="mt-4 inline-flex">
            Booking engine setup
          </Button>
        </Panel>
        {bookings.length > 0 ? <BookingsTable bookings={bookings} action={null} /> : null}
      </>
    );
  }

  return (
    <>
      {bookings.length === 0 ? (
        <Panel variant="filled" className="items-center px-5 py-10 text-center">
          <div className="text-[15px] font-medium text-ink-900">
            No bookings yet
          </div>
          <p className="mt-2.5 max-w-[420px] text-[14px] text-ink-500">
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
        <BookingsTable
          bookings={bookings}
          action={
            <Button
              href="/bookings/new"
              variant="primary"
              aria-disabled={!canCreate}
              className={canCreate ? "flex-none" : "flex-none pointer-events-none opacity-50"}
              title={canCreate ? undefined : "Finish setup before creating bookings"}
            >
              New booking
            </Button>
          }
        />
      )}
    </>
  );
}
