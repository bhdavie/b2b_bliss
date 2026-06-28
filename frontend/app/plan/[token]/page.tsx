import { fetchPlanPortal } from "@/lib/publicApi";
import { PlanPortal } from "@/components/portal/PlanPortal";

type Params = { token: string };

export default async function PlanPortalPage(props: { params: Promise<Params> }) {
  const { token } = await props.params;
  const portal = await fetchPlanPortal(token);

  if (!portal) {
    return (
      <div className="min-h-screen bg-white text-ink font-body">
        <div className="mx-auto max-w-2xl px-6 py-24 text-center">
          <h1 className="font-display text-3xl text-brand-navy">Plan not found</h1>
          <p className="mt-3 text-sm text-ink-muted">
            This link is no longer active or the plan has been canceled. If you
            think this is a mistake, contact the merchant who sent you the link.
          </p>
        </div>
      </div>
    );
  }

  return <PlanPortal token={token} initial={portal} />;
}
