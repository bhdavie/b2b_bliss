import { redirect } from "next/navigation";
import { OnboardingWizard } from "@/components/merchant/OnboardingWizard";
import { fetchMerchantSession } from "@/lib/auth";

export default async function OnboardingPage() {
  const session = await fetchMerchantSession();
  if (!session) {
    redirect("/login");
  }
  if (session.onboardingComplete) {
    redirect("/dashboard");
  }

  return (
    <main className="min-h-screen bg-surface-subtle py-10 px-6">
      <div className="max-w-xl mx-auto">
        <header className="text-center">
          <div className="text-xl font-medium tracking-tight">bliss</div>
          <h1 className="mt-6 text-2xl font-medium">Set up your business</h1>
          <p className="mt-1 text-ink-muted">
            Three quick steps. Stripe Connect comes after this in the next phase.
          </p>
        </header>

        <OnboardingWizard
          initial={{
            businessName: session.businessName ?? "",
            businessType: session.businessType ?? "",
            phone: session.phone ?? "",
            addressLine1: session.address.line1 ?? "",
            addressLine2: session.address.line2 ?? "",
            addressCity: session.address.city ?? "",
            addressState: session.address.state ?? "",
            addressZip: session.address.zip ?? "",
          }}
        />
      </div>
    </main>
  );
}
