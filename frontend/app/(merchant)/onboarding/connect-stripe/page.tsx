import { redirect } from "next/navigation";
import { BlissWordmark } from "@/components/BlissWordmark";
import { ConnectStripeStep } from "@/components/merchant/ConnectStripeStep";
import { InstallSteps } from "@/components/merchant/InstallSteps";
import { fetchMerchantSession } from "@/lib/auth";

// Second step of the Mews-install flow: connect Stripe. Lives outside the
// (authenticated) group so the layout's onboarding redirect doesn't intercept,
// but still needs a session (set during the marketplace authorize step).
//
// Frame, wordmark and step rail are plan-rules'. This screen has no title of its
// own to put in a PageHeader, so the property context line carries the head on
// its own, in PageHeader's subtitle treatment and at PageHeader's spacing.

export default async function ConnectStripePage() {
  const session = await fetchMerchantSession();
  if (!session) {
    redirect("/login");
  }

  return (
    <main className="min-h-screen bg-white font-body text-ink-900">
      <div className="mx-auto flex max-w-[1136px] flex-col px-6 pb-[72px] pt-16 xl:px-16">
        <BlissWordmark className="mb-12 text-[22px] tracking-[-0.005em] text-brand-violet" />

        <p className="mb-12 text-lg text-ink-500">
          Connected to Mews · {session.businessName ?? "your property"}
        </p>

        <div className="mb-14">
          <InstallSteps current="stripe" />
        </div>

        <ConnectStripeStep />
      </div>
    </main>
  );
}
