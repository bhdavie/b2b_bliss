import { fetchPlanPortal } from "@/lib/publicApi";
import { PlanPortal } from "@/components/portal/PlanPortal";
import { PortalShell } from "@/components/portal/PortalShell";
import { Panel } from "@/components/ui/primitives";

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
        {/* Was a bare centred h1 and paragraph on the sand ground — the only
            screen in either surface with no card at all. Now the same empty-state
            card the plan lists use, so a dead link lands on a surface rather
            than on the page background. */}
        <Panel variant="filled" className="items-center px-5 py-10 text-center">
          <div className="text-[15px] font-medium text-ink-900">
            Plan not found
          </div>
          <p className="mt-2.5 max-w-[420px] text-[14px] text-ink-500">
            This link is no longer active or the plan has been canceled. If you
            think this is a mistake, contact the property that sent you the link.
          </p>
        </Panel>
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
