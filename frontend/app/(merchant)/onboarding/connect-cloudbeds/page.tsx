import { redirect } from "next/navigation";
import { BlissWordmark } from "@/components/BlissWordmark";
import { ConnectCloudbedsStep } from "@/components/merchant/ConnectCloudbedsStep";
import { InstallSteps } from "@/components/merchant/InstallSteps";
import { fetchMerchantSession, fetchOnboardingServer } from "@/lib/auth";

// Onboarding step: connect Cloudbeds via OAuth. Session-gated. Mirrors the Mews
// connect page; the step itself redirects to the backend OAuth start endpoint.
//
// Frame, head and footer rule are the Mews connect page's, which are in turn
// plan-rules'.
export default async function ConnectCloudbedsPage() {
  const session = await fetchMerchantSession();
  if (!session) {
    redirect("/login");
  }
  const onboarding = await fetchOnboardingServer();
  const already = onboarding?.cloudbeds?.connected
    ? {
        propertyName: onboarding.cloudbeds.propertyName,
        currency: onboarding.cloudbeds.currency,
      }
    : null;

  return (
    <main className="min-h-screen bg-white font-inter text-ink-900">
      <div className="mx-auto flex max-w-[1136px] flex-col px-6 pb-[72px] pt-16 xl:px-16">
        <BlissWordmark className="mb-12 text-[22px] tracking-[-0.005em] text-brand-violet" />

        <p className="mb-12 text-lg text-ink-500">Connecting Cloudbeds</p>

        <div className="mb-14">
          <InstallSteps status={onboarding} />
        </div>

        <ConnectCloudbedsStep alreadyConnected={already} />

        <div className="mt-14 border-t border-sand-200 pt-8">
          <a
            href="/onboarding/pms"
            className="text-[17px] font-medium text-brand-violet no-underline transition-colors hover:text-brand-violet-deep hover:underline"
          >
            Choose a different PMS
          </a>
        </div>
      </div>
    </main>
  );
}
