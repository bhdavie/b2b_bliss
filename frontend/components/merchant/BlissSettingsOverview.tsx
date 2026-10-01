import type { BlissSetting, BlissSettingSource, BlissSettingsView } from "@/lib/api";
import { Panel, SectionHeading } from "@/components/ui/primitives";
import { BookingTypeSelect, ResyncMewsButton } from "./BlissSettingsControls";

/**
 * Every setting that governs how Bliss runs for the property, in one read-only
 * card (configurable-property spec, phase 1). Each shows its value in plain
 * language and where it comes from, so a hotel can see at a glance what is a
 * default, what it chose, and what follows its PMS. Editing stays where it is
 * today (plan rules below, PMS settings in the PMS) until the setup screens of
 * phase 6.
 */
const GROUPS: { key: BlissSetting["group"]; title: string }[] = [
  { key: "payouts", title: "How you get paid" },
  { key: "synced", title: "Synced from your systems" },
  { key: "plans", title: "Payment plans" },
  { key: "fees", title: "Fees" },
  { key: "emails", title: "Emails" },
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
        const settings = view.settings.filter((s) => s.group === group.key);
        if (settings.length === 0) return null;
        return (
          <section key={group.key} className="flex flex-col gap-[10px]">
            <div className="flex flex-wrap items-center justify-between gap-[8px]">
              <h3 className="text-[15px] font-medium text-ink-900">{group.title}</h3>
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
