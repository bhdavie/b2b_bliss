import { Card } from "@/components/ui/Card";
import { fetchMerchantSession } from "@/lib/auth";

export default async function PayoutsPage() {
  const session = await fetchMerchantSession();
  // Mews-rail properties are the merchant of record: guests are charged through
  // Mews and funds settle to the property's own account, so Bliss never routes a
  // payout. Only the Stripe rail has a Bliss-driven payout. Keep this page from
  // contradicting the Connections card ("Charged through Mews").
  const isMews = session?.pmsType === "mews";

  return (
    <>
      <header>
        <h1 className="text-3xl font-bold">Payouts</h1>
        <p className="mt-1 text-ink-muted">
          {isMews
            ? "Your guests are charged through Mews, so payments settle directly to your property's own account. Bliss does not hold or route these funds."
            : "Payouts route through Stripe Connect once you complete onboarding."}
        </p>
      </header>

      <Card padding="2xl" className="mt-8 text-center">
        <div className="text-sm font-medium">No payouts yet</div>
        <p className="mt-1 text-ink-muted text-sm">
          {isMews
            ? "Mews-rail plans settle straight to your property, so there is nothing to route here."
            : "You will see plans pay out here once a plan completes."}
        </p>
      </Card>
    </>
  );
}
