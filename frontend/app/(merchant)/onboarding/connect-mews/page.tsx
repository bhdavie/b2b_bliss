import { redirect } from "next/navigation";
import { BlissWordmark } from "@/components/BlissWordmark";
import { ConnectMewsStep } from "@/components/merchant/ConnectMewsStep";
import { fetchMerchantSession, fetchOnboardingServer } from "@/lib/auth";

// Onboarding step: connect Mews with Connector API tokens. Session-gated.
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
    <main className="min-h-screen bg-white px-6 py-10 font-body">
      <div className="mx-auto max-w-xl">
        <header className="text-center">
          <BlissWordmark className="text-xl tracking-tight text-brand-navy" />
          <p className="mt-1 text-sm text-ink-muted">
            Connecting Mews · {session.businessName ?? "your property"}
          </p>
        </header>

        <div className="mt-8">
          <ConnectMewsStep alreadyConnected={already} />
        </div>

        <p className="mt-8 text-center text-sm">
          <a href="/onboarding/pms" className="text-brand-purple hover:underline">
            Choose a different PMS
          </a>
        </p>
      </div>
    </main>
  );
}
