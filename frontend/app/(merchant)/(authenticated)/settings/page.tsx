import { BlissSettingsOverview } from "@/components/merchant/BlissSettingsOverview";
import { PaymentSettingsTabs } from "@/components/merchant/PaymentSettingsTabs";
import { DEFAULT_PLAN_RULES } from "@/lib/api";
import { fetchBlissSettingsServer, fetchMerchantSession, fetchPlanRulesServer } from "@/lib/auth";

export default async function SettingsPage() {
  // Independent reads, so they go out together rather than one after the other.
  // fetchPlanRulesServer returns null on 401 instead of throwing, so firing it
  // before the session check is safe; the layout is what redirects a signed-out
  // request anyway.
  const [session, planRules, blissSettings] = await Promise.all([
    fetchMerchantSession(),
    fetchPlanRulesServer(),
    fetchBlissSettingsServer(),
  ]);
  if (!session) return null;

  return (
    <div className="flex flex-col gap-[24px]">
      {blissSettings ? <BlissSettingsOverview view={blissSettings} /> : null}
      <PaymentSettingsTabs
        planRules={planRules ?? DEFAULT_PLAN_RULES}
        isMews={session.pmsType === "mews"}
        currency={session.currency}
        locale={session.locale}
        timeZone={session.timeZone}
      />
    </div>
  );
}
