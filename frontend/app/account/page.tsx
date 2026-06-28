import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  fetchAccountPlans,
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

  const active = data.plans.filter((p) => p.status === "active");
  const totalRemaining = active.reduce((sum, p) => sum + p.remainingCents, 0);
  const next = nextPaymentAcross(active);
  const greetingName = data.email.split("@")[0] ?? "there";

  return (
    <PortalShell active="home">
      <p className="text-[11px] uppercase tracking-[0.25em] text-ink-muted">
        Your Bliss account
      </p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-brand-navy">
        Welcome back, {greetingName}
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

      <h2 className="mt-10 text-xl font-semibold text-brand-navy">Your plans</h2>
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
      <div className="text-[10px] uppercase tracking-[0.18em] text-ink-muted">
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold tabular-nums text-brand-navy">
        {value}
      </div>
      {sub ? <div className="mt-0.5 text-xs text-ink-muted">{sub}</div> : null}
    </div>
  );
}
