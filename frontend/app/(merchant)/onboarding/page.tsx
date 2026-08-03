import { redirect } from "next/navigation";
import { BlissWordmark } from "@/components/BlissWordmark";
import { OnboardingWizard } from "@/components/merchant/OnboardingWizard";
import { PageHeader } from "@/components/ui/primitives";
import { fetchMerchantSession } from "@/lib/auth";

// Page frame is plan-rules' frame, character for character: the (authenticated)
// shell's surface and rhythm, the same 1136px column centred with mx-auto since
// the funnel has no sidebar, the same wordmark and the same PageHeader.

export default async function OnboardingPage() {
  const session = await fetchMerchantSession();
  if (!session) {
    redirect("/login");
  }
  if (session.onboardingComplete) {
    redirect("/home");
  }

  return (
    <main className="min-h-screen bg-white font-body text-ink-900">
      <div className="mx-auto flex max-w-[1136px] flex-col px-6 pb-[72px] pt-16 xl:px-16">
        <BlissWordmark className="mb-12 text-[22px] tracking-[-0.005em] text-brand-violet" />

        <PageHeader
          title="Set up your business"
          subtitle="Three quick steps to get your property set up."
        />

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
