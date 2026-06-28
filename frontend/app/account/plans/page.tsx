import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { fetchAccountPlans } from "@/lib/publicApi";
import { PortalShell } from "@/components/portal/PortalShell";
import { PlansList } from "@/components/account/PlansList";

export default async function AccountPlansPage() {
  const cookieStore = await cookies();
  if (!cookieStore.get("bliss_customer_session")?.value) {
    redirect("/account/login");
  }
  const cookieHeader = (await headers()).get("cookie") ?? null;
  const data = await fetchAccountPlans(cookieHeader);
  if (!data) {
    redirect("/account/login");
  }

  const active = data.plans.filter(
    (p) => !p.complete && p.status !== "canceled",
  );

  return (
    <PortalShell active="plans">
      <h1 className="text-4xl font-bold tracking-tight text-brand-navy">
        Active plans
      </h1>
      <p className="mt-1 text-sm text-ink-muted">
        Plans that are still being paid. Open one to pay early or cancel.
      </p>
      <div className="mt-6">
        <PlansList
          plans={active}
          emptyTitle="No active plans"
          emptyBody="When you set up a payment plan it shows here until the final installment clears."
        />
      </div>
    </PortalShell>
  );
}
