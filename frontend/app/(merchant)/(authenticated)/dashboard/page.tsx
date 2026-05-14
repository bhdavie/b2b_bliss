import { fetchMerchantSession } from "@/lib/auth";

export default async function DashboardPage() {
  const session = await fetchMerchantSession();
  if (!session) return null;

  return (
    <>
      <header>
        <h1 className="text-2xl font-medium">Dashboard</h1>
        <p className="mt-1 text-ink-muted">
          Welcome to Bliss. Bookings and payouts land in upcoming phases.
        </p>
      </header>

      <section className="mt-8 grid gap-4 md:grid-cols-2">
        <div className="card p-5">
          <div className="text-xs text-ink-muted">Business</div>
          <div className="mt-1 text-sm font-medium">{session.businessName}</div>
          <div className="mt-0.5 text-xs text-ink-soft capitalize">
            {session.businessType}
          </div>
        </div>

        <div className="card p-5">
          <div className="text-xs text-ink-muted">Stripe Connect</div>
          <div className="mt-1 text-sm font-medium capitalize">
            {(session.stripeConnectStatus ?? "not_started").replace(/_/g, " ")}
          </div>
          <p className="mt-2 text-xs text-ink-soft">
            We will wire this up in Phase 2 so you can take payouts.
          </p>
        </div>
      </section>

      <section className="mt-8 card-subtle">
        <div className="text-xs text-ink-muted">Account</div>
        <div className="mt-1 text-sm">{session.email}</div>
        <div className="mt-1 text-xs text-ink-soft font-mono">{session.id}</div>
      </section>
    </>
  );
}
