import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { fetchAccountPlans, fetchPlanPortal } from "@/lib/publicApi";
import { PortalShell } from "@/components/portal/PortalShell";
import { PlanPortal } from "@/components/portal/PlanPortal";
import { PlansList } from "@/components/account/PlansList";

// Carried over from the former /account/plans, which was more specific than
// the generic PlansList default ("No plans yet" / "When a merchant sends you
// a payment-plan link...").
const EMPTY_TITLE = "No active plans";
const EMPTY_BODY =
  "When you set up a payment plan it shows here until the final installment clears.";

export default async function AccountPage() {
  const cookieStore = await cookies();
  if (!cookieStore.get("bliss_customer_session")?.value) {
    redirect("/account/login");
  }
  const cookieHeader = (await headers()).get("cookie") ?? null;
  const data = await fetchAccountPlans(cookieHeader);
  if (!data) {
    redirect("/account/login");
  }

  // Check-in ascending: the soonest stay first. The list had no sort at all,
  // so rows arrived in creation order, which matches neither the date the row
  // now leads with nor any order a guest would look for.
  const active = data.plans
    .filter((p) => !p.complete && p.status !== "canceled")
    .slice()
    .sort((a, b) => a.appointmentDate.localeCompare(b.appointmentDate));

  // Exactly one active plan: render that plan directly, through the same
  // component /plan/[token] uses rather than a parallel implementation.
  const only = active.length === 1 ? (active[0] ?? null) : null;
  if (only) {
    const portal = await fetchPlanPortal(only.bookingToken);
    // A failed portal fetch falls through to the list rather than erroring:
    // the list can still render from the data we already have.
    if (portal) {
      return (
        <PortalShell active="home" email={data.email}>
          <PlanPortal
            token={only.bookingToken}
            initial={portal}
            backHref={null}
          />
        </PortalShell>
      );
    }
  }

  // The greeting is gone with the page header, and with it the name lookup it
  // needed: resolving a display name used to cost an extra fetchPlanPortal call
  // on every render of this page purely to read a customerNameHint.

  return (
    <PortalShell active="home" email={data.email}>
      {/* "Your plans" was a 24px h2 on the sand ground above a stack of plan
          cards. It is the list's heading now, inside the one card that holds
          the list — see the note in PlansList for why the group merged into a
          single card rather than the heading moving into the first plan. */}
      <PlansList
        plans={active}
        from="home"
        title="Your plans"
        emptyTitle={EMPTY_TITLE}
        emptyBody={EMPTY_BODY}
      />
    </PortalShell>
  );
}
