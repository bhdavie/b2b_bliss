import { fetchMerchantSession } from "@/lib/auth";
import { Panel } from "@/components/ui/primitives";

export default async function PayoutsPage() {
  const session = await fetchMerchantSession();
  // Mews-rail properties are the merchant of record: guests are charged through
  // Mews and funds settle to the property's own account, so Bliss never routes a
  // payout. Only the Stripe rail has a Bliss-driven payout. Keep this page from
  // contradicting the Connections card ("Charged through Mews").
  const isMews = session?.pmsType === "mews";

  return (
    <div className="flex max-w-[980px] flex-col">
      <h1 className="mb-11 text-[44px] font-medium leading-[1.05] tracking-[-0.035em] text-ink-900">
        Payouts
      </h1>

      <Panel className="items-center gap-5 bg-sand-50 px-16 pb-20 pt-[76px] text-center">
        <div className="text-[28px] font-medium tracking-[-0.02em] text-ink-900">
          No payouts yet
        </div>
        <p className="max-w-[560px] text-lg leading-[1.6] text-ink-500">
          {isMews
            ? "Your guests are charged through Mews, so payments settle directly to your property's own account. Bliss does not hold or route these funds."
            : "Payouts route through Stripe Connect once you complete onboarding. You will see plans pay out here once a plan completes."}
        </p>
      </Panel>
    </div>
  );
}
