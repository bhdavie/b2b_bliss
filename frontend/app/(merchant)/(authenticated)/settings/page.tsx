import { fetchMerchantSession } from "@/lib/auth";

export default async function SettingsPage() {
  const session = await fetchMerchantSession();
  if (!session) return null;

  return (
    <>
      <header>
        <h1 className="text-2xl font-medium">Settings</h1>
        <p className="mt-1 text-ink-muted">
          Account info pulled from your merchant profile.
        </p>
      </header>

      <section className="mt-8 card p-6 space-y-4">
        <Row label="Email" value={session.email} />
        <Row label="Business name" value={session.businessName} />
        <Row label="Business type" value={session.businessType} />
        <Row label="Phone" value={session.phone} />
        <Row
          label="Address"
          value={[
            session.address.line1,
            session.address.line2,
            [session.address.city, session.address.state, session.address.zip]
              .filter(Boolean)
              .join(", "),
          ]
            .filter(Boolean)
            .join("\n")}
        />
      </section>
    </>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="grid grid-cols-3 gap-4 text-sm">
      <div className="text-ink-muted">{label}</div>
      <div className="col-span-2 whitespace-pre-line">
        {value ?? <span className="text-ink-soft">Not set</span>}
      </div>
    </div>
  );
}
