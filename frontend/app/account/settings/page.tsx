import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { fetchAccountPlans, fetchPlanPortal } from "@/lib/publicApi";
import { PortalShell } from "@/components/portal/PortalShell";
import { PageHeader, Panel, SectionHeading } from "@/components/ui/primitives";
import { SettingsCardOnFile } from "@/components/portal/SettingsCardOnFile";

export default async function AccountSettingsPage() {
  const cookieStore = await cookies();
  if (!cookieStore.get("bliss_customer_session")?.value) {
    redirect("/account/login");
  }
  const cookieHeader = (await headers()).get("cookie") ?? null;
  const data = await fetchAccountPlans(cookieHeader);
  if (!data) {
    redirect("/account/login");
  }

  // Card on file + name come from any one of the customer's plans (the card is
  // shared across plans). Prefer an active plan.
  const anchor =
    data.plans.find((p) => p.status === "active") ?? data.plans[0] ?? null;
  const portal = anchor ? await fetchPlanPortal(anchor.bookingToken) : null;
  const name = portal?.booking.customerNameHint ?? null;

  return (
    <PortalShell active="settings" email={data.email}>
      <div className="flex flex-col pb-[72px]">
        <PageHeader
          title="Settings"
          subtitle="Your account details and the card your installments run on."
        />

        <div className="grid grid-cols-1 items-start gap-x-12 gap-y-12 xl:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
          <div className="flex flex-col">
            <SectionHeading className="mb-[26px]">Account</SectionHeading>
            <div className="flex flex-col border-t border-sand-200">
              <Field label="Name" value={name} />
              <Field label="Email" value={data.email} />
              <Field label="Phone" value={null} />
            </div>
          </div>

          <Panel className="px-8 pb-8 pt-[30px]">
            <SectionHeading className="mb-6">Card on file</SectionHeading>
            {portal && anchor ? (
              <SettingsCardOnFile
                token={anchor.bookingToken}
                card={portal.card}
                stripeConfigured={portal.stripe.configured}
                stripePublishableKey={portal.stripe.publishableKey}
              />
            ) : (
              <p className="text-[17px] text-ink-500">
                No card on file yet. Your card is saved the first time you set
                up a payment plan.
              </p>
            )}
          </Panel>
        </div>
      </div>
    </PortalShell>
  );
}

/**
 * A label/value row. A null value renders the design's muted "Not on file"
 * treatment rather than the weighted value type.
 */
function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-baseline justify-between gap-8 border-b border-sand-200 py-6">
      <div className="text-[17px] text-ink-500">{label}</div>
      {value ? (
        <div className="text-right text-[19px] font-medium tracking-[-0.01em] text-ink-900">
          {value}
        </div>
      ) : (
        <div className="text-right text-[19px] text-ink-400">Not on file</div>
      )}
    </div>
  );
}
