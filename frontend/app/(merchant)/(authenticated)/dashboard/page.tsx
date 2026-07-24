import { AccountSettings } from "@/components/merchant/AccountSettings";
import { fetchMerchantSession, fetchOnboardingServer } from "@/lib/auth";

// URL stays /dashboard (lower-risk for the demo), but the tab is now
// "Account settings" - property details + tool connections. Connection status
// comes from the same real onboarding/pms data the Overview uses, not a
// simulated store.
export default async function AccountSettingsPage() {
  const session = await fetchMerchantSession();
  if (!session) return null;
  const onboarding = await fetchOnboardingServer();

  return (
    <AccountSettings
      initial={{
        hotelName: session.businessName ?? "",
        email: session.email,
        phone: session.phone ?? "",
        addressLine1: session.address.line1 ?? "",
        addressLine2: session.address.line2 ?? "",
        addressCity: session.address.city ?? "",
        addressState: session.address.state ?? "",
        addressZip: session.address.zip ?? "",
      }}
      connections={{
        pmsType: session.pmsType,
        onboardingState: session.onboardingState,
        mews: onboarding?.mews ?? null,
        cloudbeds: onboarding?.cloudbeds ?? null,
        stripeConnectStatus: session.stripeConnectStatus,
      }}
    />
  );
}
