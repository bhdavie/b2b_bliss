import { redirect } from "next/navigation";
import { BlissWordmark } from "@/components/BlissWordmark";
import { ConnectMewsStep } from "@/components/merchant/ConnectMewsStep";
import { InstallSteps } from "@/components/merchant/InstallSteps";
import { fetchMerchantSession, fetchOnboardingServer } from "@/lib/auth";

// Onboarding step: connect Mews with Connector API tokens. Session-gated.
//
// Frame and wordmark are plan-rules'. No title of its own, so the property
// context line carries the head in PageHeader's subtitle treatment; the closing
// link takes plan-rules' footer rule.
export default async function ConnectMewsPage() {
  const session = await fetchMerchantSession();
  if (!session) {
    redirect("/login");
  }
  const onboarding = await fetchOnboardingServer();
  const already =
    onboarding?.mews?.connected && onboarding.mews.enterpriseName
      ? {
          enterpriseName: onboarding.mews.enterpriseName,
          currency: onboarding.mews.currency ?? "",
        }
      : null;

  return (
    <main className="min-h-screen bg-white font-body text-ink-900">
      <div className="mx-auto flex max-w-[1136px] flex-col px-6 pb-[72px] pt-16 xl:px-16">
        <BlissWordmark className="mb-12 text-[22px] tracking-[-0.005em] text-brand-violet" />

        <p className="mb-12 text-lg text-ink-500">Connecting Mews</p>

        <div className="mb-14">
          <InstallSteps status={onboarding} />
        </div>

        <ConnectMewsStep alreadyConnected={already} />

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
