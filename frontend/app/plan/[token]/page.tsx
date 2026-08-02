import { fetchPlanPortal } from "@/lib/publicApi";
import { PlanPortal } from "@/components/portal/PlanPortal";
import { PortalShell } from "@/components/portal/PortalShell";

type Params = { token: string };
type Search = { from?: string | string[] };

/**
 * Where the guest came from. /plan/[token] has no nav item of its own, so it
 * borrows the tab of the list that linked here and points its back-link at the
 * same list. PlanCard writes the `?from=` value; see PlanOrigin there.
 */
const ORIGINS = {
  home: { active: "home", backHref: "/account" },
  history: { active: "history", backHref: "/account/history" },
} as const;

const ORIGIN_KEYS = ["home", "history"] as const;

/**
 * The param is user-controlled, so it is matched against the allowlist rather
 * than indexed with. Missing, repeated (string[]), or unrecognised values fall
 * back to Home, which is the behaviour this route had before the param existed.
 */
function resolveOrigin(raw: string | string[] | undefined) {
  const key = ORIGIN_KEYS.find((k) => k === raw) ?? "home";
  return ORIGINS[key];
}

export default async function PlanPortalPage(props: {
  params: Promise<Params>;
  searchParams: Promise<Search>;
}) {
  const { token } = await props.params;
  const { from } = await props.searchParams;
  const origin = resolveOrigin(from);
  const portal = await fetchPlanPortal(token);

  if (!portal) {
    return (
      <PortalShell active={origin.active}>
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
    <PortalShell active={origin.active} email={portal.booking.customerEmailHint}>
      <PlanPortal
        token={token}
        initial={portal}
        backHref={origin.backHref}
      />
    </PortalShell>
  );
}
