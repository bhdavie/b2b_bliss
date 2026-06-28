import Link from "next/link";
import { redirect } from "next/navigation";
import { BlissWordmark } from "@/components/BlissWordmark";
import { StripeConnectCard } from "@/components/merchant/StripeConnectCard";
import { fetchMerchantSession, fetchStripeStatusServer } from "@/lib/auth";

export default async function StripeReturnPage() {
  const session = await fetchMerchantSession();
  if (!session) {
    redirect("/login");
  }
  const status = await fetchStripeStatusServer();
  if (!status) {
    redirect("/login");
  }

  // If everything is good, send them straight to the overview.
  if (status.status === "charges_enabled") {
    redirect("/home");
  }

  return (
    <main className="min-h-screen bg-white py-10 px-6 font-body">
      <div className="max-w-xl mx-auto">
        <header className="text-center">
          <BlissWordmark className="text-xl tracking-tight text-brand-navy" />
          <h1 className="mt-6 text-2xl font-medium">
            Back from Stripe
          </h1>
          <p className="mt-1 text-ink-muted">
            Here is what Stripe is telling us about your account.
          </p>
        </header>

        <div className="mt-8">
          <StripeConnectCard status={status} />
        </div>

        <p className="mt-6 text-center text-sm">
          <Link href="/home" className="text-brand-purple">
            Go to overview
          </Link>
        </p>
      </div>
    </main>
  );
}
