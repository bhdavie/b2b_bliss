import { redirect } from "next/navigation";
import { BlissWordmark } from "@/components/BlissWordmark";
import { OnboardingWizard } from "@/components/merchant/OnboardingWizard";
import { fetchMerchantSession } from "@/lib/auth";

export default async function OnboardingPage() {
  const session = await fetchMerchantSession();
  if (!session) {
    redirect("/login");
  }
  if (session.onboardingComplete) {
    redirect("/home");
  }

  return (
    <main className="min-h-screen bg-white py-10 px-6 font-body">
      <div className="max-w-xl mx-auto">
        <header className="text-center">
          <BlissWordmark className="text-xl tracking-tight text-brand-purple" />
          <h1 className="mt-6 text-2xl font-medium text-brand-navy">Set up your business</h1>
          <p className="mt-1 text-brand-navy">
            Three quick steps to get your property set up.
          </p>
        </header>

        <OnboardingWizard
          initial={{
            businessName: session.businessName ?? "",
            businessType: session.businessType ?? "",
            numberOfRooms: "",
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
