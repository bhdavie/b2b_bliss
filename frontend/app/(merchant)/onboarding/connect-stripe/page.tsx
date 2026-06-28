import { redirect } from "next/navigation";
import { BlissWordmark } from "@/components/BlissWordmark";
import { ConnectStripeStep } from "@/components/merchant/ConnectStripeStep";
import { InstallSteps } from "@/components/merchant/InstallSteps";
import { fetchMerchantSession } from "@/lib/auth";

// Second step of the Mews-install flow: connect Stripe. Lives outside the
// (authenticated) group so the layout's onboarding redirect doesn't intercept,
// but still needs a session (set during the marketplace authorize step).

export default async function ConnectStripePage() {
  const session = await fetchMerchantSession();
  if (!session) {
    redirect("/login");
  }

  return (
    <main className="min-h-screen bg-white px-6 py-10 font-body">
      <div className="mx-auto max-w-xl">
        <header className="text-center">
          <BlissWordmark className="text-xl tracking-tight text-brand-navy" />
          <p className="mt-1 text-sm text-ink-muted">
            Connected to Mews · {session.businessName ?? "your property"}
          </p>
        </header>

        <div className="mt-8">
          <InstallSteps current="stripe" />
        </div>

        <div className="mt-8">
          <ConnectStripeStep />
        </div>
      </div>
    </main>
  );
}
