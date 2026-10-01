import { InstallSnippet } from "@/components/merchant/InstallSnippet";

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

// For a Google Tag Manager Custom HTML tag. The config goes in a global set
// by its own inline script, not in data attributes on the loader: GTM
// re-creates the script elements it injects, and the overlay should not
// depend on how faithfully it copies attributes across.
function mewsSnippet(slug: string): string {
  return [
    `<script>`,
    `  window.__blissOverlayConfig = {`,
    `    merchant: "${slug}",`,
    `    apiBase: "${OVERLAY_API_BASE}"`,
    `  };`,
    `</script>`,
    `<script src="${OVERLAY_SCRIPT_SRC}"></script>`,
  ].join("\n");
}

const GTM_STEPS = [
  "In Mews, make sure your booking engine loads your Google Tag Manager container.",
  "In Google Tag Manager, open that container and go to Tags, then New.",
  "Under Tag Configuration choose Custom HTML.",
  "Paste the snippet below into the HTML field.",
  "Under Triggering choose All Pages.",
  "Save the tag, then Submit to publish your container.",
];

/**
 * Adding the Bliss pop-up to a Mews booking engine through Google Tag Manager:
 * the steps, with the property's own snippet at the step that needs it. Used on
 * the install page and the last setup screen.
 */
export function MewsInstallGuide({ slug }: { slug: string }) {
  return (
    <>
      <p className="mb-3 max-w-[760px] text-[14px] leading-[1.4] text-ink-500">
        This snippet carries your property&apos;s own identifier, so it
        picks up your plan rules and your Bliss rates automatically. If
        you change either later, the snippet does not need updating.
      </p>
      {GTM_STEPS.map((step, i) => {
        const isLast = i === GTM_STEPS.length - 1;
        return (
          <div key={step} className="grid grid-cols-[36px_minmax(0,1fr)] gap-x-[22px]">
            <div className="flex flex-col items-center">
              <div className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-brand-violet text-[14px] font-semibold text-white">
                {i + 1}
              </div>
              {isLast ? null : <div className="min-h-4 w-[1.5px] flex-1 bg-brand-lavender" />}
            </div>
            <div className={`text-[14px] leading-[1.4] text-ink-900 ${isLast ? "pt-1.5" : "pb-[26px] pt-1.5"}`}>
              {step}
              {i === 2 ? (
                <div className="mt-4">
                  <InstallSnippet snippet={mewsSnippet(slug)} />
                </div>
              ) : null}
            </div>
          </div>
        );
      })}
    </>
  );
}
