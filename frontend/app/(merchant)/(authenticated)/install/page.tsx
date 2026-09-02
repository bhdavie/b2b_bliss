import { InstallSnippet } from "@/components/merchant/InstallSnippet";
import { Panel, SectionHeading } from "@/components/ui/primitives";
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
    <div className="flex flex-col">
      {/* The page's orienting line used to float above this card as a
          PageLead. It moved inside, because the card it was floating over is
          the one that answers it: the lead says Bliss goes into your booking
          engine, and the line under it names which engine is yours. Two
          sentences of the same thought, now on the same surface. */}
      <Panel variant="filled" className="mb-3 gap-3 p-5">
        <SectionHeading className="mb-1">Your booking engine</SectionHeading>
        <p className="text-[14px] leading-[1.4] text-ink-900">
          Add Bliss to your booking engine so guests see a payment plan while
          they book.
        </p>
        <p className="text-[14px] leading-[1.4] text-ink-900">
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
          <Panel variant="filled" className="p-5">
            <SectionHeading className="mb-4">
              Add Bliss through Google Tag Manager
            </SectionHeading>
            <p className="mb-3 max-w-[760px] text-[14px] leading-[1.4] text-ink-500">
              This snippet carries your property&apos;s own identifier, so it
              picks up your plan rules automatically. If you change your plan
              settings later, the snippet does not need updating.
            </p>
            {GTM_STEPS.map((step, i) => {
              const isLast = i === GTM_STEPS.length - 1;
              return (
                <div
                  key={step}
                  className="grid grid-cols-[36px_minmax(0,1fr)] gap-x-[22px]"
                >
                  <div className="flex flex-col items-center">
                    <div className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-brand-violet text-[14px] font-semibold text-white">
                      {i + 1}
                    </div>
                    {isLast ? null : (
                      <div className="min-h-4 w-[1.5px] flex-1 bg-brand-lavender" />
                    )}
                  </div>
                  <div
                    className={`text-[14px] leading-[1.4] text-ink-900 ${
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
          <Panel variant="filled" className="p-5">
            <SectionHeading className="mb-4">Add Bliss to your booking engine</SectionHeading>
            {/* The Cloudbeds equivalent is Booking Engine Extensions rather than
                a Tag Manager container, so the snippet shape and the injection
                point both differ from Mews. Not built yet; no snippet is shown
                rather than one that would not load. */}
            <p className="text-[14px] leading-[1.4] text-ink-900">
              The Cloudbeds install uses Booking Engine Extensions rather than a
              tag container. We are still building it, so there is nothing to
              paste yet. We will be in touch as soon as it is ready.
            </p>
          </Panel>
        </>
      ) : null}

      {/* The no-booking-engine case. `none` is the new default for a property
          that has not picked a rail, and `stripe` is the legacy no-PMS rail;
          neither has an engine to install into, so both land here. Before
          `none` existed this read `pms === "stripe"` alone, which after the
          default changed would have shown a new property nothing at all. */}
      {pms === "none" || pms === "stripe" ? (
        <>
          <Panel variant="filled" className="gap-3 p-5">
            <SectionHeading className="mb-4">Add Bliss to your booking engine</SectionHeading>
            <p className="text-[14px] leading-[1.4] text-ink-900">
              You have not connected a booking engine yet, so there is nothing
              to install. Your guests can still pay over time through the
              payment links you send them.
            </p>
            <p className="text-[14px] leading-[1.4] text-ink-900">
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
