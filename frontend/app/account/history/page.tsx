import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { fetchAccountPlans } from "@/lib/publicApi";
import { PortalShell } from "@/components/portal/PortalShell";
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
      {canceledToken ? (
        <div className="mb-6 rounded-none border border-brand-lavender bg-brand-lavender/15 px-5 py-4">
          <div className="text-base font-bold text-brand-navy">
            Cancellation confirmed
          </div>
          <p className="mt-1 text-sm text-ink-muted">
            Your plan has been cancelled and the remaining payments are stopped.
          </p>
        </div>
      ) : null}
      <h1 className="text-4xl font-bold tracking-tight text-brand-navy">
        Plan history
      </h1>
      <p className="mt-1 text-sm text-ink-muted">
        Plans that are paid off or cancelled.
      </p>
      <div className="mt-6">
        <PlansList
          plans={past}
          muted
          emptyTitle="Nothing here yet"
          emptyBody="Completed and cancelled plans will appear here."
        />
      </div>
    </PortalShell>
  );
}
