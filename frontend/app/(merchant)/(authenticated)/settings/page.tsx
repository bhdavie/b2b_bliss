import { PaymentSettingsTabs } from "@/components/merchant/PaymentSettingsTabs";
import { PageHeader } from "@/components/ui/primitives";
import { DEFAULT_PLAN_RULES } from "@/lib/api";
import { fetchMerchantSession, fetchPlanRulesServer } from "@/lib/auth";

export default async function SettingsPage() {
  const session = await fetchMerchantSession();
  if (!session) return null;
  const planRules = await fetchPlanRulesServer();

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
