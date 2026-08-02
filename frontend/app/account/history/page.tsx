import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { fetchAccountPlans } from "@/lib/publicApi";
import { PortalShell } from "@/components/portal/PortalShell";
import { PageHeader } from "@/components/ui/primitives";
import { PlansList } from "@/components/account/PlansList";

export default async function AccountHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ canceled?: string }>;
}) {
  const cookieStore = await cookies();
  if (!cookieStore.get("bliss_customer_session")?.value) {
    redirect("/account/login");
  }
  const cookieHeader = (await headers()).get("cookie") ?? null;
  const data = await fetchAccountPlans(cookieHeader);
  if (!data) {
    redirect("/account/login");
  }

  const canceledToken = (await searchParams).canceled ?? null;

  // Pin the just-cancelled plan to the top; everything else keeps its
  // created-date order from the backend.
  const past = data.plans
    .filter((p) => p.complete || p.status === "canceled")
    .slice()
    .sort((a, b) => {
      if (a.bookingToken === canceledToken) return -1;
      if (b.bookingToken === canceledToken) return 1;
      return 0;
    });

  return (
    <PortalShell active="history" email={data.email}>
      <div className="flex flex-col pb-[72px]">
        {canceledToken ? (
          <div className="mb-12 flex flex-col gap-2 rounded-panel border border-sand-200 px-8 py-6">
            <div className="text-[22px] font-medium tracking-[-0.015em] text-ink-900">
              Cancellation confirmed
            </div>
            <p className="text-[17px] text-ink-500">
              Your plan has been cancelled and the remaining payments are
              stopped.
            </p>
          </div>
        ) : null}

        <PageHeader
          title="Plan history"
          subtitle="Plans that are paid off or cancelled."
        />

        <PlansList
          plans={past}
          from="history"
          emptyTitle="Nothing here yet"
          emptyBody="Completed and cancelled plans will appear here."
        />
      </div>
    </PortalShell>
  );
}
