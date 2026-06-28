import Link from "next/link";
import { BlissWordmark } from "@/components/BlissWordmark";

// Simulated Mews Marketplace integration-detail page for Bliss. Styled to match
// the real Mews Marketplace (light, minimal, editorial; charcoal text on white;
// "+ Add to Mews" primary action) rather than generic app-store framing. The
// "+ Add to Mews" button hands off to the simulated OAuth consent screen.

export const metadata = {
  title: "Bliss Payment Plans · Mews Marketplace",
};

// A neutral sans stack approximating Mews's clean grotesk, so this page reads
// as Mews chrome rather than the Bliss brand font.
const MEWS_FONT =
  'ui-sans-serif, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

const NAV = ["Platform", "Solutions", "Customers", "Resources", "Pricing"];

const FEATURES = [
  "Guests split a confirmed booking into scheduled payments finished before arrival",
  "No credit and no interest, with nothing for your property to underwrite",
  "Reservations sync from Mews and eligible stays become payment plans automatically",
  "Paid in full before the stay through Stripe, minus a small flat fee",
];

const SCOPES = ["Read reservations", "Read customer profiles", "Read rates and services"];

const SCREENS = ["Guest plan options", "Guest checkout", "Property dashboard"];

export default function MewsMarketplaceListing() {
  return (
    <div className="min-h-screen bg-white text-[#16181D]" style={{ fontFamily: MEWS_FONT }}>
      {/* Top nav */}
      <header className="border-b border-[#E6E8EC]">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-10">
            <span className="text-lg font-bold tracking-tight">MEWS</span>
            <nav className="hidden items-center gap-7 text-sm text-[#5B6470] lg:flex">
              {NAV.map((item) => (
                <span key={item} className="hover:text-[#16181D]">
                  {item}
                </span>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-5 text-sm">
            <span className="hidden text-[#5B6470] sm:inline">Log in</span>
            <span className="rounded-lg bg-[#FF2D6F] px-4 py-2 font-medium text-white">
              Book a demo
            </span>
          </div>
        </div>
      </header>

      {/* Marketplace sub-bar */}
      <div className="border-b border-[#E6E8EC] bg-[#F6F7F8]">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <span className="text-sm font-semibold">Mews Marketplace</span>
          <span className="hidden text-xs text-[#5B6470] sm:inline">
            1,000+ integrations. No connection fees.
          </span>
        </div>
      </div>

      <main className="mx-auto max-w-6xl px-6 py-10">
        {/* Breadcrumb */}
        <nav className="text-sm text-[#5B6470]">
          <span>Marketplace</span>
          <span className="px-2 text-[#C2C7CE]">/</span>
          <span>Payments</span>
          <span className="px-2 text-[#C2C7CE]">/</span>
          <span className="text-[#16181D]">Bliss Payment Plans</span>
        </nav>

        {/* Listing header */}
        <section className="mt-7 flex flex-col gap-6 border-b border-[#E6E8EC] pb-10 md:flex-row md:items-start md:justify-between">
          <div className="flex gap-5">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-[#C9AFFA] px-2 text-center leading-none">
              <BlissWordmark className="text-lg text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">
                Bliss Payment Plans
              </h1>
              <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-[#5B6470]">
                Scheduled payments for confirmed bookings, completed before
                arrival. By Bliss.
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded-full border border-[#E6E8EC] px-3 py-1 text-[#5B6470]">
                  Payments
                </span>
                <span className="rounded-full border border-[#E6E8EC] px-3 py-1 text-[#5B6470]">
                  Guest experiences
                </span>
              </div>
            </div>
          </div>

          <div className="shrink-0 md:text-right">
            <Link
              href="/mews-marketplace/authorize"
              className="inline-flex items-center justify-center rounded-lg bg-[#FF2D6F] px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-[#E61E5C]"
            >
              + Add to Mews
            </Link>
            <p className="mt-2 text-xs text-[#5B6470]">
              Standard integration · No connection fee
            </p>
          </div>
        </section>

        {/* Screenshots */}
        <section className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-3">
          {SCREENS.map((label) => (
            <div
              key={label}
              className="flex h-44 items-end rounded-xl border border-[#E6E8EC] bg-[#F6F7F8] p-4"
            >
              <span className="text-xs text-[#5B6470]">{label}</span>
            </div>
          ))}
        </section>

        {/* Body */}
        <div className="mt-12 grid gap-12 md:grid-cols-3">
          <div className="md:col-span-2">
            <h2 className="text-lg font-semibold">About this integration</h2>
            <div className="mt-4 space-y-4 text-[15px] leading-relaxed text-[#5B6470]">
              <p>
                Bliss lets your guests split the cost of a confirmed booking into
                scheduled payments, all completed before they arrive. There is no
                credit, no interest, and no chargeback risk to your property. When
                the final payment clears, the booking is paid in full ahead of the
                stay.
              </p>
              <p>
                Reservations flow in from Mews, and eligible stays become payment
                plans your guests can choose at checkout. You stay paid out through
                Stripe on the same timeline you already expect.
              </p>
            </div>

            <ul className="mt-8 space-y-3">
              {FEATURES.map((f) => (
                <li key={f} className="flex gap-3 text-[15px] text-[#16181D]">
                  <span className="mt-0.5 text-[#2F6BFF]">✓</span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </div>

          <aside className="space-y-8">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-[#8A919C]">
                Data access
              </h3>
              <ul className="mt-3 space-y-2 text-sm text-[#5B6470]">
                {SCOPES.map((s) => (
                  <li key={s} className="flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#16181D]" />
                    {s}
                  </li>
                ))}
              </ul>
            </div>

            <div className="border-t border-[#E6E8EC] pt-6">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-[#8A919C]">
                Works with
              </h3>
              <p className="mt-3 text-sm text-[#5B6470]">
                Mews Operations, Mews Payments, Stripe Connect
              </p>
            </div>

            <div className="border-t border-[#E6E8EC] pt-6 space-y-3 text-sm">
              <Meta label="Category" value="Payments" />
              <Meta label="Built by" value="Bliss" />
              <Meta label="Pricing" value="No connection fee" />
            </div>
          </aside>
        </div>
      </main>

      <footer className="border-t border-[#E6E8EC]">
        <div className="mx-auto max-w-6xl px-6 py-6 text-xs text-[#8A919C]">
          Mews Marketplace
        </div>
      </footer>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-[#8A919C]">{label}</span>
      <span className="text-[#16181D]">{value}</span>
    </div>
  );
}
