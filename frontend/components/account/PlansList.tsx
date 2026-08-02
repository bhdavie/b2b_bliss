import { type AccountPlanCard } from "@/lib/publicApi";
import { Panel } from "@/components/ui/primitives";
import { PlanCard, type PlanOrigin } from "./PlanCard";

export function PlansList({
  plans,
  from,
  emptyTitle = "No plans yet",
  emptyBody = "When a merchant sends you a payment-plan link, your plan will appear here automatically.",
}: {
  plans: AccountPlanCard[];
  /** Threaded through to each card so the plan screen knows the entry point. */
  from?: PlanOrigin;
  emptyTitle?: string;
  emptyBody?: string;
}) {
  if (plans.length === 0) {
    // The export does not draw an empty state; styled to match the populated
    // cards — same panel, same border and radius, quieter type.
    return (
      <Panel className="items-center px-10 py-16 text-center">
        <div className="text-[22px] font-medium tracking-[-0.015em] text-ink-900">
          {emptyTitle}
        </div>
        <p className="mt-2.5 max-w-[420px] text-[17px] text-ink-500">
          {emptyBody}
        </p>
      </Panel>
    );
  }
  return (
    <div className="flex flex-col gap-5">
      {plans.map((plan) => (
        <PlanCard key={plan.planId} plan={plan} from={from} />
      ))}
    </div>
  );
}
