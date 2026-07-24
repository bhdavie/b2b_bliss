import { redirect } from "next/navigation";
import { BlissWordmark } from "@/components/BlissWordmark";
import { PmsSelectStep } from "@/components/merchant/PmsSelectStep";
import { fetchMerchantSession } from "@/lib/auth";

// Onboarding step: choose a PMS. Lives outside the (authenticated) group so the
// focused single-column layout applies, but still requires a session.
export default async function ChoosePmsPage() {
  const session = await fetchMerchantSession();
  if (!session) {
    redirect("/login");
  }

  return (
    <main className="min-h-screen bg-white px-6 py-10 font-body">
      <div className="mx-auto max-w-xl">
        <header className="text-center">
          <BlissWordmark className="text-xl tracking-tight text-brand-navy" />
          <h1 className="mt-6 text-2xl font-bold text-brand-navy">Choose your PMS</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Where do you want to take and charge payments for {session.businessName ?? "your property"}?
          </p>
        </header>

        <div className="mt-8">
          <PmsSelectStep currentPms={session.pmsType} />
        </div>

        <p className="mt-8 text-center text-sm">
          <a href="/home" className="text-brand-purple hover:underline">
            Back to dashboard
          </a>
        </p>
      </div>
    </main>
  );
}
