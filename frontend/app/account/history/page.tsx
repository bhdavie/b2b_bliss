import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { fetchAccountPlans } from "@/lib/publicApi";
import { PortalShell } from "@/components/portal/PortalShell";
import { PlansList } from "@/components/account/PlansList";

export default async function AccountHistoryPage() {
  const cookieStore = await cookies();
  if (!cookieStore.get("bliss_customer_session")?.value) {
    redirect("/account/login");
  }
  const cookieHeader = (await headers()).get("cookie") ?? null;
  const data = await fetchAccountPlans(cookieHeader);
  if (!data) {
    redirect("/account/login");
  }

  const past = data.plans.filter(
    (p) => p.status === "completed" || p.status === "canceled",
  );

  return (
    <PortalShell active="history">
      <h1 className="text-3xl font-semibold tracking-tight text-brand-navy">
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
