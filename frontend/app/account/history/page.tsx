import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { fetchAccountPlans, formatDollars } from "@/lib/publicApi";
import { PortalShell } from "@/components/portal/PortalShell";
import { Panel } from "@/components/ui/primitives";
import { PlansList } from "@/components/account/PlansList";

export default async function AccountHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ canceled?: string; credit?: string }>;
}) {
  const cookieStore = await cookies();
  if (!cookieStore.get("bliss_customer_session")?.value) {
    redirect("/account/login");
  }
  const cookieHeader = (await headers()).get("cookie") ?? null;
  const data = await fetchAccountPlans(cookieHeader);
  if (!data) {
    redirect("/account/login");
  }

  const params = await searchParams;
  const canceledToken = params.canceled ?? null;
  // Set when a Mews stay was cancelled: the credit toward a future stay.
  const creditCents = Number.parseInt(params.credit ?? "", 10);
  const hasCredit = Number.isFinite(creditCents) && creditCents > 0;

  // Pin the just-cancelled plan to the top; everything else is most recent
  // stay first. Descending rather than /account's ascending: these stays have
  // been and gone, so the useful end of the list is the recent one, whereas on
  // the active list it is the soonest.
  const past = data.plans
    .filter((p) => p.complete || p.status === "canceled")
    .slice()
    .sort((a, b) => {
      if (a.bookingToken === canceledToken) return -1;
      if (b.bookingToken === canceledToken) return 1;
      return b.appointmentDate.localeCompare(a.appointmentDate);
    });

  return (
    <PortalShell active="history" email={data.email}>
      <div className="flex flex-col pb-10">
        {canceledToken ? (
          <Panel variant="filled" className="mb-3 gap-3 p-5">
            <div className="text-[15px] font-medium text-ink-900">
              Cancellation confirmed
            </div>
            <p className="text-[14px] text-ink-500">
              Your plan has been cancelled and the remaining payments are
              stopped.
            </p>
            {hasCredit ? (
              <p className="text-[14px] text-ink-500">
                {formatDollars(creditCents)} is now credit toward a future stay with the
                property. They&apos;ll apply it when you book with them again.
              </p>
            ) : null}
          </Panel>
        ) : null}

        {/* The orienting line was a PageLead floating above the plan cards.
            It is the list card's helper now. The heading beside it is "Past
            plans" rather than "History": the sidebar already says History, and
            repeating it would put the same word twice on one screen for no
            gain. The helper is the line that actually does the work here — it
            is what tells a guest a cancelled plan belongs on this page
            alongside a paid-off one. */}
        <PlansList
          plans={past}
          from="history"
          title="Past plans"
          helper="Plans that are paid off or cancelled."
          showNextPayment={false}
          emptyTitle="Nothing here yet"
          emptyBody="Completed and cancelled plans will appear here."
        />
      </div>
    </PortalShell>
  );
}
