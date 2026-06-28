export default function PayoutsPage() {
  return (
    <>
      <header>
        <h1 className="text-3xl font-bold">Payouts</h1>
        <p className="mt-1 text-ink-muted">
          Payouts route through Stripe Connect once you complete onboarding in
          Phase 2.
        </p>
      </header>

      <div className="mt-8 card p-10 text-center">
        <div className="text-sm font-medium">No payouts yet</div>
        <p className="mt-1 text-ink-muted text-sm">
          You will see plans pay out here once Phase 5 ships the charge engine.
        </p>
      </div>
    </>
  );
}
