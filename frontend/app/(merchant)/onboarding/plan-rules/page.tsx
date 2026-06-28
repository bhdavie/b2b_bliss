import Link from "next/link";
import { redirect } from "next/navigation";
import { BlissWordmark } from "@/components/BlissWordmark";
import { InstallSteps } from "@/components/merchant/InstallSteps";
import { PlanRulesCard } from "@/components/merchant/PlanRulesCard";
import { PoliciesCard } from "@/components/merchant/PoliciesCard";
import { DEFAULT_PLAN_RULES } from "@/lib/api";
import { fetchMerchantSession, fetchPlanRulesServer } from "@/lib/auth";

// Final setup step: initial plan rules. Reuses the same PlanRulesCard +
// PoliciesCard the /settings page uses (each saves on its own). A fresh
// merchant has no rules row yet, so the cards open on DEFAULT_PLAN_RULES.

// Lavender primary-button treatment, unified with the merchant color mapping
// via the shared .btn-primary-merchant class (lavender fill, white label,
// square corners).
const LAVENDER_BTN = "btn-primary-merchant";

export default async function OnboardingPlanRulesPage() {
  const session = await fetchMerchantSession();
  if (!session) {
    redirect("/login");
  }
  const planRules = await fetchPlanRulesServer();

  return (
    <main className="min-h-screen bg-white px-6 py-10 font-body">
      <div className="mx-auto max-w-2xl">
        <header className="text-center">
          <BlissWordmark className="text-xl tracking-tight text-brand-purple" />
          <h1 className="mt-4 text-2xl font-medium text-brand-navy">Set your plan rules</h1>
          <p className="mt-1 text-brand-navy">
            These control which stays can offer a plan and what your guests see.
            The defaults are sensible — tweak anything and Save, or keep them and
            finish.
          </p>
        </header>

        <div className="mt-8">
          <InstallSteps current="rules" />
        </div>

        <section className="mt-8 space-y-4">
          <h2 className="text-xs font-medium uppercase tracking-wide text-brand-navy">
            Eligibility & plans
          </h2>
          <PlanRulesCard
            initial={planRules ?? DEFAULT_PLAN_RULES}
            saveButtonClassName={LAVENDER_BTN}
          />
        </section>

        <section className="mt-10 space-y-4">
          <h2 className="text-xs font-medium uppercase tracking-wide text-brand-navy">
            Cancellation & policies
          </h2>
          <PoliciesCard
            initial={planRules ?? DEFAULT_PLAN_RULES}
            saveButtonClassName={LAVENDER_BTN}
          />
        </section>

        <div className="mt-10 flex items-center justify-between border-t border-brand-neutral pt-6">
          <p className="text-sm text-brand-navy">
            You can change any of this later in Payment settings.
          </p>
          <Link href="/home" className={LAVENDER_BTN}>
            Finish setup
          </Link>
        </div>
      </div>
    </main>
  );
}
