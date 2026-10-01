import { redirect } from "next/navigation";
import { BlissWordmark } from "@/components/BlissWordmark";
import { BlissSetupWizard } from "@/components/merchant/BlissSetupWizard";
import { PageHeader } from "@/components/ui/primitives";
import { fetchBlissSettingsServer, fetchMerchantSession } from "@/lib/auth";

// Bliss setup for a Mews property, after Mews is connected: the five screens of
// the configurable-property spec (section 10.1). They replace the old booking
// setup and plan rules steps; "Switch Bliss on" finishes onboarding. Frame is
// the funnel's own, as on the other onboarding steps.
export default async function BlissSetupPage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string }>;
}) {
  const session = await fetchMerchantSession();
  if (!session) {
    redirect("/login");
  }
  if (session.onboardingComplete) {
    redirect("/settings");
  }
  if (session.pmsType !== "mews") {
    redirect("/onboarding/plan-rules");
  }
  const settings = await fetchBlissSettingsServer();
  if (!settings) {
    redirect("/login");
  }
  const { step } = await searchParams;

  return (
    <main className="min-h-screen bg-sand-100 font-inter text-ink-900">
      <div className="mx-auto flex max-w-[1136px] flex-col px-6 pb-[72px] pt-16 xl:px-16">
        <BlissWordmark className="mb-12 text-[22px] tracking-[-0.005em] text-brand-violet" />
        <PageHeader
          title="Set up Bliss"
          subtitle="Review what we've read from Mews, choose how you get paid, and switch Bliss on."
        />
        <BlissSetupWizard initial={settings} slug={session.slug} startStep={Number(step ?? 0) || 0} />
      </div>
    </main>
  );
}
