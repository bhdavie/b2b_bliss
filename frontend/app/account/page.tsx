import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  fetchAccountPlans,
  fetchPlanPortal,
  formatDollars,
  formatScheduleDateShort,
  type AccountPlanCard,
} from "@/lib/publicApi";
import { PortalShell } from "@/components/portal/PortalShell";
import { PlansList } from "@/components/account/PlansList";

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
  const totalRemaining = active.reduce((sum, p) => sum + p.remainingCents, 0);
  const next = nextPaymentAcross(active);
  // Greet by the guest's first name, never the email prefix. Read from the same
  // source Settings uses — the booking's captured name (customerNameHint) — and
  // prefer the customer-record first name when it's populated. With no name
  // anywhere, fall back to a plain "Welcome back".
  const anchor =
    data.plans.find((p) => p.status === "active") ?? data.plans[0] ?? null;
  const portal = anchor ? await fetchPlanPortal(anchor.bookingToken) : null;
  const nameHint = portal?.booking.customerNameHint ?? null;
  const firstName =
    (data.firstName?.trim() ?? "") ||
    (nameHint ? (nameHint.trim().split(/\s+/)[0] ?? "") : "");

  return (
    <PortalShell active="home" email={data.email}>
      <h1 className="text-4xl font-bold tracking-tight text-brand-navy">
        {firstName ? `Welcome back, ${firstName}` : "Welcome back"}
      </h1>
      <p className="mt-1 text-sm text-ink-muted">Signed in as {data.email}</p>

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Active plans" value={String(active.length)} />
        <Stat label="Total remaining" value={formatDollars(totalRemaining)} />
        <Stat
          label="Next payment"
          value={
            next
              ? `${formatDollars(next.nextDueAmountCents ?? 0)} · ${formatScheduleDateShort(next.nextDueDate ?? "")}`
              : "Nothing due"
          }
          sub={next ? next.merchantBusinessName : undefined}
        />
      </div>

      <h2 className="mt-10 text-2xl font-bold text-brand-navy">Your plans</h2>
      <div className="mt-4">
        <PlansList plans={active} />
      </div>
    </PortalShell>
  );
}

function nextPaymentAcross(plans: AccountPlanCard[]): AccountPlanCard | null {
  const due = plans.filter((p) => p.nextDueDate && p.nextDueAmountCents != null);
  if (due.length === 0) return null;
  return due.reduce((best, p) =>
    (p.nextDueDate ?? "") < (best.nextDueDate ?? "") ? p : best,
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-none border border-brand-lavender bg-white p-4">
      <div className="text-[10px] text-ink-muted">
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold tabular-nums text-brand-navy">
        {value}
      </div>
      {sub ? <div className="mt-0.5 text-xs text-ink-muted">{sub}</div> : null}
    </div>
  );
}
