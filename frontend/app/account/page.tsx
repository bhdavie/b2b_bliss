import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { fetchAccountPlans, fetchPlanPortal } from "@/lib/publicApi";
import { PortalShell } from "@/components/portal/PortalShell";
import { PlanPortal } from "@/components/portal/PlanPortal";
import { PlansList } from "@/components/account/PlansList";
import { PageHeader } from "@/components/ui/primitives";

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

  const active = data.plans.filter(
    (p) => !p.complete && p.status !== "canceled",
  );

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

  // Zero or several plans: the page needs its own heading, so the greeting
  // stays. Same name resolution as before — prefer the customer record's
  // first name, fall back to the booking's captured name.
  const anchor =
    data.plans.find((p) => p.status === "active") ?? data.plans[0] ?? null;
  const portal = anchor ? await fetchPlanPortal(anchor.bookingToken) : null;
  const nameHint = portal?.booking.customerNameHint ?? null;
  const firstName =
    (data.firstName?.trim() ?? "") ||
    (nameHint ? (nameHint.trim().split(/\s+/)[0] ?? "") : "");

  return (
    <PortalShell active="home" email={data.email}>
      {/* Title on the page ground, like every other route. It was briefly an
          identity card on the theory that a greeting is the guest's own detail
          rather than a route label; it is the route label, and carding it made
          this screen disagree with /home, /bookings, /install and the plan
          screen.
          Rendered through PageHeader rather than kept as its own h1: the local
          markup was 36px bold at tracking-tight over a 14px line, where every
          other route's title is 44px medium at -0.035em over 18px. Dropping the
          card alone would have moved it to the ground and left it the one title
          still styled differently. */}
      <PageHeader
        title={firstName ? `Welcome back, ${firstName}` : "Welcome back"}
        subtitle={`Signed in as ${data.email}`}
      />

      {/* "Your plans" stays on the ground. It labels the GROUP of plan cards
          below it, so there is no single card it could sit inside without
          claiming to belong to the first plan. A list label above a card group
          is the one heading this pass leaves on the ground. */}
      <h2 className="text-2xl font-bold text-ink-900">Your plans</h2>
      <div className="mt-5">
        <PlansList
          plans={active}
          from="home"
          emptyTitle={EMPTY_TITLE}
          emptyBody={EMPTY_BODY}
        />
      </div>
    </PortalShell>
  );
}
