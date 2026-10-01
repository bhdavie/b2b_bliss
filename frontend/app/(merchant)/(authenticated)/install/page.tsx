import { MewsInstallGuide } from "@/components/merchant/MewsInstallGuide";
import { MewsBookingSetup } from "@/components/merchant/MewsBookingSetup";
import { Panel, SectionHeading } from "@/components/ui/primitives";
import { fetchMerchantSession } from "@/lib/auth";

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
          {/* The Bliss rates live here as well as in onboarding: a property
              that has finished onboarding cannot get back to that step, and
              the rates (and their display deposits) change after go-live. */}
          <Panel variant="filled" className="mb-3 p-5">
            <MewsBookingSetup />
          </Panel>
          <Panel variant="filled" className="p-5">
            <SectionHeading className="mb-4">
              Add Bliss through Google Tag Manager
            </SectionHeading>
            <MewsInstallGuide slug={session.slug} />
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
