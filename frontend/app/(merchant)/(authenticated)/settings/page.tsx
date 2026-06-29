import { PlanRulesCard } from "@/components/merchant/PlanRulesCard";
import { PoliciesCard } from "@/components/merchant/PoliciesCard";
import { DEFAULT_PLAN_RULES } from "@/lib/api";
import { fetchMerchantSession, fetchPlanRulesServer } from "@/lib/auth";

export default async function SettingsPage() {
  const session = await fetchMerchantSession();
  if (!session) return null;
  const planRules = await fetchPlanRulesServer();

  return (
    <>
      <header>
        <h1 className="text-3xl font-bold text-brand-navy">Payment settings</h1>
        <p className="mt-1 text-brand-navy/70">
          Set the rules and policies for your installment plans.
        </p>
      </header>

      <section className="mt-8 space-y-4">
        <h2 className="text-sm text-brand-navy font-semibold">
          Plan rules
        </h2>
        <p className="text-xs text-brand-navy/65 -mt-2">
          Control which bookings can offer a payment plan and which cadences
          your customers see.
        </p>
        <PlanRulesCard initial={planRules ?? DEFAULT_PLAN_RULES} />
      </section>

      <section className="mt-10 space-y-4">
        <h2 className="text-sm text-brand-navy font-semibold">
          Cancellation & policies
        </h2>
        <p className="text-xs text-brand-navy/65 -mt-2">
          Refund rules, cancellation fees, payment deadlines, and how failed
          installments are handled.
        </p>
        <PoliciesCard initial={planRules ?? DEFAULT_PLAN_RULES} />
      </section>
    </>
  );
}
