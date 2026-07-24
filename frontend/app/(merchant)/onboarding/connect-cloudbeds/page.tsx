import { redirect } from "next/navigation";
import { BlissWordmark } from "@/components/BlissWordmark";
import { ConnectCloudbedsStep } from "@/components/merchant/ConnectCloudbedsStep";
import { fetchMerchantSession, fetchOnboardingServer } from "@/lib/auth";

// Onboarding step: connect Cloudbeds via OAuth. Session-gated. Mirrors the Mews
// connect page; the step itself redirects to the backend OAuth start endpoint.
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
    <main className="min-h-screen bg-white px-6 py-10 font-body">
      <div className="mx-auto max-w-xl">
        <header className="text-center">
          <BlissWordmark className="text-xl tracking-tight text-brand-navy" />
          <p className="mt-1 text-sm text-ink-muted">
            Connecting Cloudbeds · {session.businessName ?? "your property"}
          </p>
        </header>

        <div className="mt-8">
          <ConnectCloudbedsStep alreadyConnected={already} />
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
