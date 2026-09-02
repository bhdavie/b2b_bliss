import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { fetchAccountPlans, fetchPlanPortal } from "@/lib/publicApi";
import { PortalShell } from "@/components/portal/PortalShell";
import { Panel, SectionHeading } from "@/components/ui/primitives";
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
      <div className="flex flex-col pb-10">
        {/* Stacked, not side by side. These were a 1fr + 420px pair, which
            gave the Card on file panel a fixed narrow column holding one card
            brand, four digits and an expiry: mostly empty, while the Account
            panel opposite it ran its label/value rows at a width narrower than
            it needed. Neither card earns a column of its own, and every other
            stacked-card page in both surfaces reads as a single column, so this
            one now does too. */}
        <div className="flex flex-col gap-3">
          <Panel variant="filled" className="p-5">
            <SectionHeading className="mb-4">Account</SectionHeading>
            <div className="flex flex-col border-t border-sand-200">
              <Field label="Name" value={name} />
              <Field label="Email" value={data.email} />
              <Field label="Phone" value={null} />
            </div>
          </Panel>

          {/* The heading and the Panel live inside SettingsCardOnFile: the open
              editor replaces that panel rather than nesting inside it, the way
              the plan detail does. The no-plan fallback keeps them here, since
              it has no editor to open. */}
          {portal && anchor ? (
            <SettingsCardOnFile
              token={anchor.bookingToken}
              card={portal.card}
              stripeConfigured={portal.stripe.configured}
              stripePublishableKey={portal.stripe.publishableKey}
            />
          ) : (
            <Panel variant="filled" className="p-5">
              <SectionHeading className="mb-4">Card on file</SectionHeading>
              <p className="text-[14px] text-ink-500">
                No card on file yet. Your card is saved the first time you set
                up a payment plan.
              </p>
            </Panel>
          )}
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
    <div className="flex items-baseline justify-between gap-8 border-b border-sand-200 py-4">
      <div className="text-[12px] uppercase tracking-[0.08em] text-ink-500">{label}</div>
      {value ? (
        <div className="text-right text-[14px] tracking-[-0.01em] text-ink-900">
          {value}
        </div>
      ) : (
        <div className="text-right text-[14px] text-ink-500">Not on file</div>
      )}
    </div>
  );
}
