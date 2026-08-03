import { PaymentSettingsTabs } from "@/components/merchant/PaymentSettingsTabs";
import { PageHeader } from "@/components/ui/primitives";
import { DEFAULT_PLAN_RULES } from "@/lib/api";
import { fetchMerchantSession, fetchPlanRulesServer } from "@/lib/auth";

export default async function SettingsPage() {
  // Independent reads, so they go out together rather than one after the other.
  // fetchPlanRulesServer returns null on 401 instead of throwing, so firing it
  // before the session check is safe; the layout is what redirects a signed-out
  // request anyway.
  const [session, planRules] = await Promise.all([
    fetchMerchantSession(),
    fetchPlanRulesServer(),
  ]);
  if (!session) return null;

  return (
    <div className="flex max-w-[980px] flex-col">
      <PageHeader
        title="Payment settings"
        subtitle="Set the rules and policies for your installment plans."
      />
      <PaymentSettingsTabs planRules={planRules ?? DEFAULT_PLAN_RULES} />
    </div>
  );
}
