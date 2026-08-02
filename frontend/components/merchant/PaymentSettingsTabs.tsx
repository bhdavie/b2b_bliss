"use client";

import { useState } from "react";
import type { PlanRules } from "@/lib/api";
import { PlanRulesCard } from "./PlanRulesCard";
import { BlackoutDatesCard } from "./BlackoutDatesCard";
import { PoliciesCard } from "./PoliciesCard";

/**
 * Payment settings as the five-tab layout from turn 8a: one panel visible at a
 * time, each with its own save button at the foot of its own panel.
 *
 * Tabs 1 and 2 map onto whole components. Tabs 3-5 are the three panels that
 * live inside PoliciesCard, selected with its `section` prop — the fields,
 * labels, validation, save handler and PUT are untouched; only which panel
 * renders changes.
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
    <>
      <div className="mb-2 mt-10 flex gap-9 overflow-x-auto border-b border-sand-300">
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              aria-pressed={active}
              className={`whitespace-nowrap px-0.5 pb-4 text-[17px] transition-colors ${
                active
                  ? "font-medium tracking-[-0.01em] text-brand-violet shadow-[inset_0_-2px_0_#5A1BB5]"
                  : "text-ink-400 hover:text-ink-900"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <div className="pt-8">
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
    </>
  );
}
