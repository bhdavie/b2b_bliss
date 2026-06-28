import { AccountSettings } from "@/components/merchant/AccountSettings";
import { fetchMerchantSession } from "@/lib/auth";

// URL stays /dashboard (lower-risk for the demo), but the tab is now
// "Account settings" — property details + tool connections.
export default async function AccountSettingsPage() {
  const session = await fetchMerchantSession();
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
    />
  );
}
