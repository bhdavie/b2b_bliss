import { type AccountPlanCard } from "@/lib/publicApi";
import { PlanCard } from "./PlanCard";

export function PlansList({
  plans,
  muted = false,
  emptyTitle = "No plans yet",
  emptyBody = "When a merchant sends you a payment-plan link, your plan will appear here automatically.",
}: {
  plans: AccountPlanCard[];
  muted?: boolean;
  emptyTitle?: string;
  emptyBody?: string;
}) {
  if (plans.length === 0) {
    return (
      <section className="rounded-none border border-brand-neutral bg-white p-10 text-center">
        <h2 className="text-2xl font-bold text-brand-navy">{emptyTitle}</h2>
        <p className="mt-2 text-sm text-ink-muted">{emptyBody}</p>
      </section>
    );
  }
  return (
    <div className="space-y-4">
      {plans.map((plan) => (
        <PlanCard key={plan.planId} plan={plan} muted={muted} />
      ))}
    </div>
  );
}
