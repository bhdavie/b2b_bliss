export default function BookingsPage() {
  return (
    <>
      <header>
        <h1 className="text-2xl font-medium">Bookings</h1>
        <p className="mt-1 text-ink-muted">
          Create a booking and send a payment plan link. Available in Phase 3.
        </p>
      </header>

      <div className="mt-8 card p-10 text-center">
        <div className="text-sm font-medium">No bookings yet</div>
        <p className="mt-1 text-ink-muted text-sm">
          Booking creation lands in the next phase of the build.
        </p>
      </div>
    </>
  );
}
