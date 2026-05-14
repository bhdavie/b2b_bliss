import { redirect } from "next/navigation";
import { Sidebar } from "@/components/merchant/Sidebar";
import { fetchMerchantSession } from "@/lib/auth";

export default async function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await fetchMerchantSession();
  if (!session) {
    redirect("/login");
  }
  if (!session.onboardingComplete) {
    redirect("/onboarding");
  }

  return (
    <div className="min-h-screen bg-surface-subtle">
      <Sidebar email={session.email} />
      <main className="md:pl-60">
        <div className="max-w-4xl mx-auto px-6 py-8">{children}</div>
      </main>
    </div>
  );
}
