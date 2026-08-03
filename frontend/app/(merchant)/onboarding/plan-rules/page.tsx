import { redirect } from "next/navigation";
import { BlissWordmark } from "@/components/BlissWordmark";
import { InstallSteps } from "@/components/merchant/InstallSteps";
import { PlanRulesCard } from "@/components/merchant/PlanRulesCard";
import { PoliciesCard } from "@/components/merchant/PoliciesCard";
import { Button } from "@/components/ui/Button";
import { PageHeader, SectionHeading } from "@/components/ui/primitives";
import { DEFAULT_PLAN_RULES } from "@/lib/api";
import {
  fetchMerchantSession,
  fetchOnboardingServer,
  fetchPlanRulesServer,
} from "@/lib/auth";

// Final setup step: initial plan rules. Reuses the same PlanRulesCard +
// PoliciesCard the /settings page uses (each saves on its own). A fresh
// merchant has no rules row yet, so the cards open on DEFAULT_PLAN_RULES.
//
// The funnel has no design turn of its own, so the chrome is inherited from the
// settled merchant screens: the (authenticated) shell's surface and rhythm
// (bg-white, font-body, ink-900, pt-16), PageHeader for the head, SectionHeading
// for the section kickers, and the same 980px column /settings uses — these
// cards were sized inside that column. There is no sidebar here, so the column
// is centred with mx-auto and its contents stay left-aligned.
//
// The cards' save buttons are left on their own default (btn-primary-merchant),
// which is now the settled violet pill — the same class the old local constant
// pointed at, so no button changes appearance by dropping the override.

export default async function OnboardingPlanRulesPage() {
  const session = await fetchMerchantSession();
  if (!session) {
    redirect("/login");
  }
  const planRules = await fetchPlanRulesServer();
  const onboarding = await fetchOnboardingServer();

  return (
    <main className="min-h-screen bg-white font-body text-ink-900">
      <div className="mx-auto flex max-w-[1136px] flex-col px-6 pb-[72px] pt-16 xl:px-16">
        <BlissWordmark className="mb-12 text-[22px] tracking-[-0.005em] text-brand-violet" />

        <PageHeader
          title="Set your plan rules"
          subtitle="These control which stays can offer a plan and what your guests see. The defaults are sensible. Tweak anything and save, or keep them and finish."
        />

        <div className="mb-14">
          <InstallSteps status={onboarding} />
        </div>

        <SectionHeading track="0.08em" className="mb-5">
          Eligibility &amp; plans
        </SectionHeading>
        <PlanRulesCard initial={planRules ?? DEFAULT_PLAN_RULES} />

        <SectionHeading track="0.08em" className="mb-5 mt-14">
          Cancellation &amp; policies
        </SectionHeading>
        <PoliciesCard initial={planRules ?? DEFAULT_PLAN_RULES} />

        <div className="mt-14 flex flex-wrap items-center justify-between gap-4 border-t border-sand-200 pt-8">
          <p className="text-[17px] text-ink-400">
            You can change any of this later in Payment settings.
          </p>
          <Button href="/home">Finish setup</Button>
        </div>
      </div>
    </main>
  );
}
