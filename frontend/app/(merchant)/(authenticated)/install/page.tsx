import { InstallSnippet } from "@/components/merchant/InstallSnippet";
import { PageHeader, Panel } from "@/components/ui/primitives";
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
    <div className="flex max-w-[1000px] flex-col">
      <PageHeader
        title="Install"
        subtitle="Add Bliss to your booking engine so guests see a payment plan while they book."
      />

      <SubHeading>Your booking engine</SubHeading>
      <Panel className="mb-14 px-8 pb-7 pt-[26px]">
        <p className="text-lg leading-[1.55] text-ink-500">
          Bliss installs differently depending on which system takes your
          bookings. Yours is set up for{" "}
          <span className="font-medium text-ink-900">
            {pms === "mews"
              ? "Mews"
              : pms === "cloudbeds"
                ? "Cloudbeds"
                : "direct payments, with no booking engine connected"}
          </span>
          .
        </p>
      </Panel>

      {pms === "mews" ? (
        <>
          <SubHeading helper="This snippet carries your property's own identifier, so it picks up your plan rules automatically. If you change your plan settings later, the snippet does not need updating.">
            Add Bliss through Google Tag Manager
          </SubHeading>
          <Panel className="px-10 pb-10 pt-9">
            {GTM_STEPS.map((step, i) => {
              const isLast = i === GTM_STEPS.length - 1;
              return (
                <div
                  key={step}
                  className="grid grid-cols-[36px_minmax(0,1fr)] gap-x-[22px]"
                >
                  <div className="flex flex-col items-center">
                    <div className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-brand-violet text-base font-semibold text-white">
                      {i + 1}
                    </div>
                    {isLast ? null : (
                      <div className="min-h-4 w-[1.5px] flex-1 bg-brand-lavender" />
                    )}
                  </div>
                  <div
                    className={`text-[19px] leading-[1.45] text-ink-900 ${
                      isLast ? "pt-1.5" : "pb-[26px] pt-1.5"
                    }`}
                  >
                    {step}
                    {i === 2 ? (
                      <div className="mt-4">
                        <InstallSnippet snippet={mewsSnippet(session.slug)} />
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </Panel>
        </>
      ) : null}

      {pms === "cloudbeds" ? (
        <>
          <SubHeading>Add Bliss to your booking engine</SubHeading>
          <Panel className="px-8 pb-7 pt-[26px]">
            {/* The Cloudbeds equivalent is Booking Engine Extensions rather than
                a Tag Manager container, so the snippet shape and the injection
                point both differ from Mews. Not built yet; no snippet is shown
                rather than one that would not load. */}
            <p className="text-lg leading-[1.55] text-ink-500">
              The Cloudbeds install uses Booking Engine Extensions rather than a
              tag container. We are still building it, so there is nothing to
              paste yet. We will be in touch as soon as it is ready.
            </p>
          </Panel>
        </>
      ) : null}

      {pms === "stripe" ? (
        <>
          <SubHeading>Add Bliss to your booking engine</SubHeading>
          <Panel className="gap-4 px-8 pb-7 pt-[26px]">
            <p className="text-lg leading-[1.55] text-ink-500">
              You have not connected a booking engine yet, so there is nothing
              to install. Your guests can still pay over time through the
              payment links you send them.
            </p>
            <p className="text-lg leading-[1.55] text-ink-500">
              Connect Mews or Cloudbeds in{" "}
              <span className="font-medium text-ink-900">Account settings</span>{" "}
              to show plans inside your booking engine.
            </p>
          </Panel>
        </>
      ) : null}
    </div>
  );
}

/** 24px section title over an optional 17px helper line, per turns 11 and 13. */
function SubHeading({
  children,
  helper,
}: {
  children: React.ReactNode;
  helper?: string;
}) {
  return (
    <div className="mb-[22px] flex flex-col gap-2.5">
      <h2 className="text-2xl font-medium tracking-[-0.02em] text-ink-900">
        {children}
      </h2>
      {helper ? (
        <p className="max-w-[760px] text-[17px] leading-[1.55] text-ink-400">
          {helper}
        </p>
      ) : null}
    </div>
  );
}
