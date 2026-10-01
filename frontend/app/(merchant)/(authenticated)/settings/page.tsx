import { BlissSettingsOverview } from "@/components/merchant/BlissSettingsOverview";
import { HoldPayoutsCard } from "@/components/merchant/HoldPayoutsCard";
import { PaymentSettingsTabs } from "@/components/merchant/PaymentSettingsTabs";
import { DEFAULT_PLAN_RULES } from "@/lib/api";
import {
  fetchBlissSettingsServer,
  fetchHoldPayoutsServer,
  fetchHoldReleasesServer,
  fetchMerchantSession,
  fetchPlanRulesServer,
} from "@/lib/auth";

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
  // Hold mode only: what Bliss is holding and has sent.
  const holding = blissSettings?.settings.some((s) => s.key === "payoutMode" && s.value === "hold") ?? false;
  const [releases, payouts] = holding
    ? await Promise.all([fetchHoldReleasesServer(), fetchHoldPayoutsServer()])
    : [null, null];

  return (
    <div className="flex flex-col gap-[24px]">
      {blissSettings ? (
        <BlissSettingsOverview view={blissSettings} isMews={session.pmsType === "mews"} />
      ) : null}
      {holding ? (
        <HoldPayoutsCard
          releases={releases ?? []}
          payouts={payouts ?? []}
          locale={session.locale}
          timeZone={session.timeZone}
        />
      ) : null}
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
