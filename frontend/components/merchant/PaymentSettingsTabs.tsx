"use client";

import { useState } from "react";
import type { PlanRules } from "@/lib/api";
import { Panel } from "@/components/ui/primitives";
import { PlanRulesCard } from "./PlanRulesCard";
import { BlackoutDatesCard } from "./BlackoutDatesCard";
import { PoliciesCard } from "./PoliciesCard";

/**
 * Payment settings as the five-tab layout from turn 8a: one section visible at
 * a time, each with its own save button at its foot.
 *
 * Tabs 1 and 2 map onto whole components. Tabs 3-5 are the three sections that
 * live inside PoliciesCard, selected with its `section` prop — the fields,
 * labels, validation, save handler and PUT are untouched; only which section
 * renders changes.
 *
 * The tab row used to sit on the page ground with the card below it, on the
 * reasoning that these tabs choose WHICH card renders rather than filtering one
 * card's contents (which is why /bookings' tabs went inside its table card).
 * That distinction no longer buys an exemption: nothing sits loose on the
 * ground. So the row moved inside and became the card's head, and the three
 * children stopped drawing panels of their own — one card, tabs at the top,
 * the selected section beneath. The active tab names the content, so the card
 * takes no separate heading, exactly as the bookings table takes none.
 */
const TABS = [
  { key: "rules", label: "Plan rules" },
  { key: "blackout", label: "Blackout dates" },
  { key: "cancellation", label: "Cancellation and policies" },
  { key: "deadline", label: "Payment deadline" },
  { key: "failed", label: "Failed payment handling" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export function PaymentSettingsTabs({ planRules }: { planRules: PlanRules }) {
  const [tab, setTab] = useState<TabKey>("rules");

  return (
    <Panel variant="filled" className="overflow-hidden p-5">
      {/* Full-bleed rule: the row is pulled out to the card's edges so its
          underline reads as a divider across the card rather than a hairline
          floating inside it, then the buttons are pushed back onto the card's
          own padding.

          flex-wrap, not overflow-x-auto. The row was nowrap and scrolled, but
          the Panel clips its overflow, so below about 1280px the last tab
          ("Failed payment handling") was simply cut off at the card edge with
          no way to reach it: 78px lost at 1280, 178px at 1100. Wrapping keeps
          every tab reachable at any width instead of hiding the rightmost one.
          The column gap drops 36px -> 24px so wrapping is rarer to begin with.

          pt-6 (24px) against the card's own px-5/py-3: 4px MORE headroom than a
          normal card, because the row's full-bleed rule reads as a header strip
          and needs to sit clear of the top edge rather than flush against it. */}
      <div className="-mx-5 flex flex-wrap gap-x-5 border-b border-sand-200 px-5">
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              aria-pressed={active}
              className={`whitespace-nowrap px-0.5 pb-4 text-[18px] transition-colors ${
                active
                  ? "font-medium tracking-[-0.01em] text-brand-violet shadow-[inset_0_-2px_0_#8B5CF6]"
                  : "text-ink-500 hover:text-ink-900"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <div className="pt-4">
        {tab === "rules" ? <PlanRulesCard initial={planRules} /> : null}
        {tab === "blackout" ? <BlackoutDatesCard initial={planRules} /> : null}
        {tab === "cancellation" ? (
          <PoliciesCard initial={planRules} section="cancellation" />
        ) : null}
        {tab === "deadline" ? (
          <PoliciesCard initial={planRules} section="deadline" />
        ) : null}
        {tab === "failed" ? (
          <PoliciesCard initial={planRules} section="failed" />
        ) : null}
      </div>
    </Panel>
  );
}
