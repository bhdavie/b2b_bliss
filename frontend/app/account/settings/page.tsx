import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { fetchAccountPlans, fetchPlanPortal } from "@/lib/publicApi";
import { PortalShell } from "@/components/portal/PortalShell";
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
      <h1 className="text-4xl font-bold tracking-tight text-brand-navy">
        Settings
      </h1>
      <p className="mt-1 text-sm text-ink-muted">
        Your account details and the card your installments run on.
      </p>

      <section className="mt-6 rounded-none border border-brand-neutral bg-white p-6">
        <h2 className="text-2xl font-bold text-brand-navy">Account</h2>
        <dl className="mt-4 space-y-3">
          <Field label="Name" value={name ?? "Not on file"} />
          <Field label="Email" value={data.email} />
          <Field label="Phone" value="Not on file" />
        </dl>
      </section>

      <section className="mt-6 rounded-none border border-brand-neutral bg-white p-6">
        <h2 className="text-2xl font-bold text-brand-navy">Card on file</h2>
        <div className="mt-4">
          {portal ? (
            <SettingsCardOnFile
              token={anchor!.bookingToken}
              card={portal.card}
              stripeConfigured={portal.stripe.configured}
              stripePublishableKey={portal.stripe.publishableKey}
            />
          ) : (
            <p className="text-sm text-ink-muted">
              No card on file yet. Your card is saved the first time you set up a
              payment plan.
            </p>
          )}
        </div>
      </section>
    </PortalShell>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-brand-neutral pb-3 last:border-b-0 last:pb-0">
      <dt className="text-xs text-ink-muted">
        {label}
      </dt>
      <dd className="text-right text-sm text-ink">{value}</dd>
    </div>
  );
}
