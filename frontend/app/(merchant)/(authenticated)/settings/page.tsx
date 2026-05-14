import { PlanRulesCard } from "@/components/merchant/PlanRulesCard";
import { PoliciesCard } from "@/components/merchant/PoliciesCard";
import { StripeConnectCard } from "@/components/merchant/StripeConnectCard";
import { DEFAULT_PLAN_RULES } from "@/lib/api";
import {
  fetchMerchantSession,
  fetchPlanRulesServer,
  fetchStripeStatusServer,
} from "@/lib/auth";

export default async function SettingsPage() {
  const session = await fetchMerchantSession();
  if (!session) return null;
  const [stripeStatus, planRules] = await Promise.all([
    fetchStripeStatusServer(),
    fetchPlanRulesServer(),
  ]);

  return (
    <>
      <header>
        <h1 className="text-2xl font-medium">Settings</h1>
        <p className="mt-1 text-ink-muted">
          Account info and payouts.
        </p>
      </header>

      <section className="mt-8 space-y-4">
        <h2 className="text-xs uppercase tracking-wide text-ink-muted font-medium">
          Plan rules
        </h2>
        <p className="text-xs text-ink-muted -mt-2">
          Control which bookings can offer a payment plan and which cadences
          your customers see.
        </p>
        <PlanRulesCard initial={planRules ?? DEFAULT_PLAN_RULES} />
      </section>

      <section className="mt-10 space-y-4">
        <h2 className="text-xs uppercase tracking-wide text-ink-muted font-medium">
          Cancellation & policies
        </h2>
        <p className="text-xs text-ink-muted -mt-2">
          Refund rules, cancellation fees, payment deadlines, and how failed
          installments are handled.
        </p>
        <PoliciesCard initial={planRules ?? DEFAULT_PLAN_RULES} />
      </section>

      <section className="mt-10 space-y-4">
        <h2 className="text-xs uppercase tracking-wide text-ink-muted font-medium">
          Payouts
        </h2>
        {stripeStatus ? (
          <StripeConnectCard status={stripeStatus} />
        ) : (
          <div className="card p-5 text-sm text-ink-muted">
            Could not load Stripe status.
          </div>
        )}
      </section>

      <section className="mt-10 space-y-4">
        <h2 className="text-xs uppercase tracking-wide text-ink-muted font-medium">
          Business
        </h2>
        <div className="card p-6 space-y-4">
          <Row label="Email" value={session.email} />
          <Row label="Business name" value={session.businessName} />
          <Row label="Business type" value={session.businessType} />
          <Row label="Phone" value={session.phone} />
          <Row
            label="Address"
            value={[
              session.address.line1,
              session.address.line2,
              [session.address.city, session.address.state, session.address.zip]
                .filter(Boolean)
                .join(", "),
            ]
              .filter(Boolean)
              .join("\n")}
          />
        </div>
      </section>
    </>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="grid grid-cols-3 gap-4 text-sm">
      <div className="text-ink-muted">{label}</div>
      <div className="col-span-2 whitespace-pre-line">
        {value ?? <span className="text-ink-soft">Not set</span>}
      </div>
    </div>
  );
}
