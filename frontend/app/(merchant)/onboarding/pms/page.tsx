import { redirect } from "next/navigation";
import { BlissWordmark } from "@/components/BlissWordmark";
import { PmsSelectStep } from "@/components/merchant/PmsSelectStep";
import { PageHeader } from "@/components/ui/primitives";
import { fetchMerchantSession } from "@/lib/auth";

// Onboarding step: choose a PMS. Lives outside the (authenticated) group so the
// focused single-column layout applies, but still requires a session.
//
// Frame, wordmark and head are plan-rules'; the closing link takes plan-rules'
// footer rule so every screen in the funnel ends the same way.
export default async function ChoosePmsPage() {
  const session = await fetchMerchantSession();
  if (!session) {
    redirect("/login");
  }

  return (
    <main className="min-h-screen bg-white font-body text-ink-900">
      <div className="mx-auto flex max-w-[1136px] flex-col px-6 pb-[72px] pt-16 xl:px-16">
        <BlissWordmark className="mb-12 text-[22px] tracking-[-0.005em] text-brand-violet" />

        <PageHeader
          title="Choose your PMS"
          subtitle={`Where do you want to take and charge payments for ${session.businessName ?? "your property"}?`}
        />

        <PmsSelectStep currentPms={session.pmsType} />

        <div className="mt-14 border-t border-sand-200 pt-8">
          <a
            href="/home"
            className="text-[17px] font-medium text-brand-violet no-underline transition-colors hover:text-brand-violet-deep hover:underline"
          >
            Back to dashboard
          </a>
        </div>
      </div>
    </main>
  );
}
