import { redirect } from "next/navigation";
import { BlissWordmark } from "@/components/BlissWordmark";
import { ConnectStripeStep } from "@/components/merchant/ConnectStripeStep";
import { fetchMerchantSession } from "@/lib/auth";

// Stripe Connect for a property with no PMS, plus the demo rail. NOT part of the
// onboarding funnel: a Mews or Cloudbeds property charges through its own PMS
// gateway, so there is nothing for Bliss to connect. The route and its component
// stay live and working, but nothing in the funnel routes here and the funnel's
// progress rail is deliberately absent, because Stripe is not one of its steps.
//
// Lives outside the (authenticated) group so the layout's onboarding redirect
// doesn't intercept, but still needs a session.
//
// Frame and wordmark are plan-rules'. This screen has no title of its own to put
// in a PageHeader, so the property context line carries the head on its own, in
// PageHeader's subtitle treatment and at PageHeader's spacing.

export default async function ConnectStripePage() {
  const session = await fetchMerchantSession();
  if (!session) {
    redirect("/login");
  }

  return (
    <main className="min-h-screen bg-white font-body text-ink-900">
      <div className="mx-auto flex max-w-[1136px] flex-col px-6 pb-[72px] pt-16 xl:px-16">
        <BlissWordmark className="mb-12 text-[22px] tracking-[-0.005em] text-brand-violet" />

        <p className="mb-12 text-lg text-ink-500">Connecting Stripe</p>

        <ConnectStripeStep />
      </div>
    </main>
  );
}
