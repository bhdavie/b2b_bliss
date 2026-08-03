import { AccountSettings } from "@/components/merchant/AccountSettings";
import { fetchMerchantSession, fetchOnboardingServer } from "@/lib/auth";

// URL stays /dashboard (lower-risk for the demo), but the tab is now
// "Account settings" - property details + tool connections. Connection status
// comes from the same real onboarding/pms data the Overview uses, not a
// simulated store.
export default async function AccountSettingsPage() {
  // Independent reads, so they go out together rather than one after the other.
  // fetchOnboardingServer returns null on 401 instead of throwing, so firing it
  // before the session check is safe; the layout is what redirects a signed-out
  // request anyway.
  const [session, onboarding] = await Promise.all([
    fetchMerchantSession(),
    fetchOnboardingServer(),
  ]);
  if (!session) return null;

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
