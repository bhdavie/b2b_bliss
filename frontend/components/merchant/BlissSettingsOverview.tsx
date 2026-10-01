import type { BlissSetting, BlissSettingSource, BlissSettingsView } from "@/lib/api";
import { Panel, SectionHeading } from "@/components/ui/primitives";
import {
  BlissSettingEditor,
  BookingTypeSelect,
  ResyncMewsButton,
  isEditableHere,
} from "./BlissSettingsControls";

/**
 * Every setting that governs how Bliss runs for the property (configurable-
 * property spec, section 10.1, "Settings, afterwards"): what is synced from its
 * systems, read only with "Resync now", and its own Bliss choices, editable.
 * Each shows its value in plain language and where it comes from. Plan settings
 * are edited in the payment settings tabs below; Payouts, in hold mode, is its
 * own card.
 */
const GROUPS: { key: string; title: string; members: BlissSetting["group"][] }[] = [
  { key: "synced", title: "Synced from your systems", members: ["synced"] },
  { key: "choices", title: "Your Bliss choices", members: ["payouts", "plans", "fees", "emails"] },
];

const SOURCE_LABEL: Record<BlissSettingSource, string> = {
  default: "Default",
  hotel: "Your choice",
  mews: "From Mews",
  cloudbeds: "From Cloudbeds",
  stripe: "From Stripe",
  bliss: "Set by Bliss",
};

export function BlissSettingsOverview({
  view,
  isMews = false,
}: {
  view: BlissSettingsView;
  isMews?: boolean;
}) {
  return (
    <Panel className="gap-[20px] p-[28px]">
      <div className="flex flex-col gap-[6px]">
        <SectionHeading>Bliss settings</SectionHeading>
        <p className="text-[14px] text-ink-500">
          {view.enabled
            ? "Bliss is on. Everything below has a value, so nothing needs setting up."
            : "Bliss isn't switched on yet. These are the settings it will start with."}
        </p>
      </div>
      {GROUPS.map((group) => {
        const settings = view.settings.filter((s) => group.members.includes(s.group));
        if (settings.length === 0) return null;
        return (
          <section key={group.key} className="flex flex-col gap-[10px]">
            <div className="flex flex-wrap items-center justify-between gap-[8px]">
              <h3 className="text-[15px] font-medium text-ink-900">
                {group.key === "synced" && isMews ? "Synced from Mews" : group.title}
              </h3>
              {group.key === "synced" && isMews ? <ResyncMewsButton /> : null}
            </div>
            <dl className="flex flex-col divide-y divide-sand-200">
              {settings.map((s) => (
                <div key={s.key} className="flex flex-col gap-[2px] py-[10px] sm:flex-row sm:items-start sm:gap-[16px]">
                  <dt className="flex flex-col gap-[2px] sm:w-[45%]">
                    <span className="text-[14px] text-ink-900">{s.label}</span>
                    <span className="text-[13px] text-ink-500">{s.help}</span>
                  </dt>
                  <dd className="flex flex-1 flex-col gap-[4px] sm:items-end sm:text-right">
                    <span className="text-[14px] text-ink-900">{s.display}</span>
                    <span className="text-[12px] text-ink-500">{SOURCE_LABEL[s.source]}</span>
                    {isEditableHere(s) ? <BlissSettingEditor setting={s} /> : null}
                    {s.editable && s.group === "plans" ? (
                      <span className="text-[12px] text-ink-500">Change it in payment settings below</span>
                    ) : null}
                    {s.key.startsWith("bookingType:") ? (
                      <BookingTypeSelect
                        rateId={s.key.slice("bookingType:".length)}
                        followsMews={s.source === "mews"}
                        value={String(s.value)}
                      />
                    ) : null}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        );
      })}
    </Panel>
  );
}
