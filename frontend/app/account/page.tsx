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
      <h1 className="text-4xl font-bold tracking-tight text-ink-900">
        {firstName ? `Welcome back, ${firstName}` : "Welcome back"}
      </h1>
      <p className="mt-1 text-sm text-ink-500">Signed in as {data.email}</p>

      <h2 className="mt-10 text-2xl font-bold text-ink-900">Your plans</h2>
      <div className="mt-4">
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
