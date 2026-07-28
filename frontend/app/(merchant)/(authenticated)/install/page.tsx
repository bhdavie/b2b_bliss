import { InstallSnippet } from "@/components/merchant/InstallSnippet";
import { fetchMerchantSession } from "@/lib/auth";

/**
 * Where the hosted overlay script is served from, and which API it reads its
 * plan rules from.
 *
 * Deliberately NOT NEXT_PUBLIC_API_BASE_URL: that resolves to localhost:8080 in
 * development, and a merchant pasting a localhost URL into their production Tag
 * Manager container would ship a snippet that silently never loads. These
 * default to the deployed hosts and are overridable for a staging container.
 */
const OVERLAY_SCRIPT_SRC =
  process.env.NEXT_PUBLIC_OVERLAY_SCRIPT_SRC ??
  "https://property.bliss-payments.com/mews-overlay.js";
const OVERLAY_API_BASE =
  process.env.NEXT_PUBLIC_OVERLAY_API_BASE ?? "https://api.bliss-payments.com";

function mewsSnippet(slug: string): string {
  return [
    `<script src="${OVERLAY_SCRIPT_SRC}"`,
    `        data-bliss-merchant="${slug}"`,
    `        data-bliss-api="${OVERLAY_API_BASE}"></script>`,
  ].join("\n");
}

const GTM_STEPS = [
  "In Google Tag Manager, open your container and go to Tags, then New.",
  "Under Tag Configuration choose Custom HTML.",
  "Paste the snippet below into the HTML field.",
  "Under Triggering choose All Pages.",
  "Save the tag, then Submit to publish your container.",
];

export default async function InstallPage() {
  const session = await fetchMerchantSession();
  if (!session) return null;

  const pms = session.pmsType;

  return (
    <>
      <header>
        <h1 className="text-3xl font-bold text-brand-navy">Install</h1>
        <p className="mt-1 text-brand-navy/70">
          Add Bliss to your booking engine so guests see a payment plan while
          they book.
        </p>
      </header>

      <section className="mt-8 space-y-4">
        <h2 className="text-sm font-semibold text-brand-navy">
          Your booking engine
        </h2>
        <p className="-mt-2 text-xs text-brand-navy/65">
          Bliss installs differently depending on which system takes your
          bookings. Yours is set up for{" "}
          <span className="font-semibold text-brand-navy">
            {pms === "mews"
              ? "Mews"
              : pms === "cloudbeds"
                ? "Cloudbeds"
                : "direct payments, with no booking engine connected"}
          </span>
          .
        </p>
      </section>

      {pms === "mews" ? (
        <section className="mt-10 space-y-4 border-t border-brand-neutral pt-6">
          <h2 className="text-sm font-semibold text-brand-navy">
            Add Bliss through Google Tag Manager
          </h2>
          <p className="-mt-2 text-xs text-brand-navy/65">
            This snippet carries your property&apos;s own identifier, so it
            picks up your plan rules automatically. If you change your plan
            settings later, the snippet does not need updating.
          </p>

          <ol className="space-y-1.5 text-xs text-brand-navy/80">
            {GTM_STEPS.map((step, i) => (
              <li key={step} className="flex gap-2.5">
                <span className="flex h-4 w-4 shrink-0 items-center justify-center bg-brand-lavender text-[10px] font-semibold text-brand-navy">
                  {i + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>

          <InstallSnippet snippet={mewsSnippet(session.slug)} />
        </section>
      ) : null}

      {pms === "cloudbeds" ? (
        <section className="mt-10 space-y-4 border-t border-brand-neutral pt-6">
          <h2 className="text-sm font-semibold text-brand-navy">
            Add Bliss to your booking engine
          </h2>
          <p className="-mt-2 text-xs text-brand-navy/65">
            {/* The Cloudbeds equivalent is Booking Engine Extensions rather than
                a Tag Manager container, so the snippet shape and the injection
                point both differ from Mews. Not built yet — no snippet is shown
                rather than one that would not load. */}
            The Cloudbeds install uses Booking Engine Extensions rather than a
            tag container. We are still building it, so there is nothing to
            paste yet. We will be in touch as soon as it is ready.
          </p>
        </section>
      ) : null}

      {pms === "stripe" ? (
        <section className="mt-10 space-y-4 border-t border-brand-neutral pt-6 opacity-60">
          <h2 className="text-sm font-semibold text-brand-navy">
            Add Bliss to your booking engine
          </h2>
          <p className="-mt-2 text-xs text-brand-navy/65">
            You have not connected a booking engine yet, so there is nothing to
            install. Your guests can still pay over time through the payment
            links you send them.
          </p>
          <p className="text-xs text-brand-navy/65">
            Connect Mews or Cloudbeds in{" "}
            <span className="font-semibold text-brand-navy">
              Account settings
            </span>{" "}
            to show plans inside your booking engine.
          </p>
        </section>
      ) : null}
    </>
  );
}
