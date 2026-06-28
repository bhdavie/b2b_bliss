import { type AccountPlanCard } from "@/lib/publicApi";
import { PlanCard } from "./PlanCard";

export function PlansList({ plans }: { plans: AccountPlanCard[] }) {
  if (plans.length === 0) {
    return (
      <section className="rounded-lg border border-brand-neutral bg-white/70 p-10 text-center shadow-sm backdrop-blur-sm">
        <h2 className="font-display text-xl text-brand-navy">No plans yet</h2>
        <p className="mt-2 text-sm text-ink-muted">
          When a merchant sends you a payment-plan link, your plan will appear
          here automatically.
        </p>
      </section>
    );
  }
  return (
    <div className="space-y-4">
      {plans.map((plan) => (
        <PlanCard key={plan.planId} plan={plan} />
      ))}
    </div>
  );
}
