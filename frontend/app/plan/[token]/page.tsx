import { fetchPlanPortal } from "@/lib/publicApi";
import { PlanPortal } from "@/components/portal/PlanPortal";
import { PortalShell } from "@/components/portal/PortalShell";

type Params = { token: string };

export default async function PlanPortalPage(props: { params: Promise<Params> }) {
  const { token } = await props.params;
  const portal = await fetchPlanPortal(token);

  if (!portal) {
    return (
      <PortalShell active="plans">
        <div className="py-16 text-center">
          <h1 className="text-4xl font-bold tracking-tight text-brand-navy">
            Plan not found
          </h1>
          <p className="mt-3 text-sm text-ink-muted">
            This link is no longer active or the plan has been canceled. If you
            think this is a mistake, contact the merchant who sent you the link.
          </p>
        </div>
      </PortalShell>
    );
  }

  return (
    <PortalShell active="plans">
      <PlanPortal token={token} initial={portal} />
    </PortalShell>
  );
}
