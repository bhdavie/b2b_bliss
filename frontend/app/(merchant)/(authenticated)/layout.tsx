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
  // Incomplete properties are NOT bounced out: they land on the dashboard and
  // see a setup checklist (rendered on /home) until they go live.

  return (
    <div className="min-h-screen bg-white font-body text-ink-900">
      <Sidebar email={session.email} businessName={session.businessName} />
      <main className="md:pl-[264px]">
        <div className="mx-auto max-w-[1136px] px-6 pb-[72px] pt-16 xl:px-16">
          {children}
        </div>
      </main>
    </div>
  );
}
