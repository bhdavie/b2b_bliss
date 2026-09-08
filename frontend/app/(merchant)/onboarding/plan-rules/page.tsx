import { redirect } from "next/navigation";
import { BlissWordmark } from "@/components/BlissWordmark";
import { BlackoutDatesCard } from "@/components/merchant/BlackoutDatesCard";
import { InstallSteps } from "@/components/merchant/InstallSteps";
import { PlanRulesCard } from "@/components/merchant/PlanRulesCard";
import { PoliciesCard } from "@/components/merchant/PoliciesCard";
import { Button } from "@/components/ui/Button";
import { PageHeader, Panel, SectionHeading } from "@/components/ui/primitives";
import { DEFAULT_PLAN_RULES } from "@/lib/api";
import {
  fetchMerchantSession,
  fetchOnboardingServer,
  fetchPlanRulesServer,
} from "@/lib/auth";

// Final setup step: initial plan rules. Reuses the same PlanRulesCard,
// BlackoutDatesCard and PoliciesCard the /settings page uses (each saves on its
// own). A fresh merchant has no rules row yet, so the cards open on
// DEFAULT_PLAN_RULES.
//
// All three read the same single fetchPlanRulesServer() result, exactly as the
// settings page hands one PlanRules object to all five of its tabs.
//
// The funnel has no design turn of its own, so the chrome is borrowed from the
// settled merchant screens: the same ground and type the (authenticated) shell
// paints (bg-sand-100, font-inter, ink-900), PageHeader for the head,
// SectionHeading for the section kickers, and a filled Panel around each card —
// the white-card-on-sand treatment /settings and /home both use. There is no
// sidebar here, so the column is centred with mx-auto and its contents stay
// left-aligned.
//
// The Panels live here rather than in the cards because PlanRulesCard,
// BlackoutDatesCard and PoliciesCard each dropped their own when
// PaymentSettingsTabs became the card on /settings. That left this screen, their
// only other call site, with no card at all. p-5 is the padding those components
// expect a parent to supply, and is what PaymentSettingsTabs gives them.
//
// The column and top padding are the funnel's own (1136px, pt-16); the shell
// runs 1320px at pt-6. This note previously described the inherited surface as
// bg-white and "the same 980px column /settings uses" — bg-white was the
// pre-rebrand ground, and neither screen has ever had a 980px column.
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
    <main className="min-h-screen bg-sand-100 font-inter text-ink-900">
      <div className="mx-auto flex max-w-[1136px] flex-col px-6 pb-[72px] pt-16 xl:px-16">
        <BlissWordmark className="mb-12 text-[22px] tracking-[-0.005em] text-brand-violet" />

        <PageHeader
          title="Set your plan rules"
          subtitle="These control which stays can offer a plan and what your guests see. The defaults are sensible. Tweak anything and save, or keep them and finish."
        />

        <div className="mb-14">
          <InstallSteps status={onboarding} />
        </div>

        <SectionHeading className="mb-5">
          Eligibility &amp; plans
        </SectionHeading>
        <Panel variant="filled" className="p-5">
          <PlanRulesCard initial={planRules ?? DEFAULT_PLAN_RULES} />
        </Panel>

        <SectionHeading className="mb-5 mt-14">
          Blackout dates
        </SectionHeading>
        <Panel variant="filled" className="p-5">
          <BlackoutDatesCard initial={planRules ?? DEFAULT_PLAN_RULES} />
        </Panel>

        <SectionHeading className="mb-5 mt-14">
          Cancellation &amp; policies
        </SectionHeading>
        <Panel variant="filled" className="p-5">
          <PoliciesCard initial={planRules ?? DEFAULT_PLAN_RULES} />
        </Panel>

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
