import Link from "next/link";
import { StripeConnectCard } from "@/components/merchant/StripeConnectCard";
import { fetchMerchantSession, fetchStripeStatusServer } from "@/lib/auth";

export default async function DashboardPage() {
  const session = await fetchMerchantSession();
  if (!session) return null;
  const stripeStatus = await fetchStripeStatusServer();
  const chargesEnabled = stripeStatus?.status === "charges_enabled";

  return (
    <>
      <header>
        <h1 className="text-2xl font-medium">Dashboard</h1>
        <p className="mt-1 text-ink-muted">
          Welcome to Bliss. {chargesEnabled
            ? "Create your first booking to start taking payment plans."
            : "Finish Stripe setup to start taking bookings."}
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

        {stripeStatus ? (
          <StripeConnectCard status={stripeStatus} />
        ) : (
          <div className="card p-5 text-sm text-ink-muted">
            Stripe status unavailable.
          </div>
        )}
      </section>

      {chargesEnabled ? (
        <section className="mt-8 card p-5 flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">Ready to take bookings</div>
            <p className="text-xs text-ink-muted mt-1">
              Create a booking to generate a payment plan link.
            </p>
          </div>
          <Link href="/bookings" className="btn-primary">
            New booking
          </Link>
        </section>
      ) : null}

      <section className="mt-8 card-subtle">
        <div className="text-xs text-ink-muted">Account</div>
        <div className="mt-1 text-sm">{session.email}</div>
        <div className="mt-1 text-xs text-ink-soft font-mono">{session.id}</div>
      </section>
    </>
  );
}
