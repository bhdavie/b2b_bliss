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

  // bg-sand-100 is the app's page ground, and this element is the only thing
  // that sets it. It used to be bg-white, which was a redundant repaint of the
  // body's own white and left the page LIGHTER than the cards sitting on it —
  // cards read as recessed, and #FFFFFF is not a value the palette defines.
  // Sunken (#F6F4F1) under white cards restores the direction the token set
  // describes. Deliberately not moved to globals.css body: body is shared with
  // the guest checkout (/pay, /checkout), the hotel demo pages and the
  // transitional auth screens, several of which paint no ground of their own
  // and would inherit an app colour they are not part of.
  return (
    <div className="min-h-screen bg-sand-100 font-inter text-ink-900">
      <Sidebar email={session.email} businessName={session.businessName} />
      <main className="md:pl-[264px]">
        {/* pt-10, down from pt-16. With the PageHeader gone the first card
            would otherwise have started 64px down with nothing above it, which
            reads as the header's empty socket rather than as breathing room. */}
        <div className="mx-auto max-w-[1136px] px-6 pb-[72px] pt-10 xl:px-16">
          {children}
        </div>
      </main>
    </div>
  );
}
