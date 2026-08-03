"use client";

import { useMemo, useState } from "react";
import { updatePlanRules, type PlanRules } from "@/lib/api";

// Rolling window the merchant can pick from: today through today + 365 days.
const WINDOW_DAYS = 365;
// Mirrors MAX_BLACKOUT_DATES in PlanRulesResource.
const MAX_BLACKOUT_DATES = 400;

// Local-noon-safe date handling, same approach as lib/eligibility and the
// funnels: build Dates from y/m/d parts so nothing shifts under UTC, and format
// back by parts rather than through toISOString.
function parseIso(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}
function toIso(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}
function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

type MonthGrid = {
  key: string;
  label: string;
  // Leading blanks so the 1st lands under its real weekday column.
  lead: number;
  days: { iso: string; day: number; selectable: boolean }[];
};

function buildMonths(from: Date, to: Date): MonthGrid[] {
  const months: MonthGrid[] = [];
  const cursor = new Date(from.getFullYear(), from.getMonth(), 1);
  while (cursor <= to) {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const first = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const days: MonthGrid["days"] = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(year, month, d);
      days.push({
        iso: toIso(date),
        day: d,
        selectable: date >= from && date <= to,
      });
    }
    months.push({
      key: `${year}-${month}`,
      label: first.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
      lead: first.getDay(),
      days,
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return months;
}

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

export function BlackoutDatesCard({
  initial,
  saveButtonClassName = "btn-primary-merchant",
}: {
  initial: PlanRules;
  saveButtonClassName?: string;
}) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(initial.blackoutDates ?? []),
  );
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Anchor for shift-click range selection.
  const [lastClicked, setLastClicked] = useState<string | null>(null);

  const today = useMemo(startOfToday, []);
  const windowEnd = useMemo(() => addDays(today, WINDOW_DAYS), [today]);
  const months = useMemo(() => buildMonths(today, windowEnd), [today, windowEnd]);

  function toggle(iso: string, shiftKey: boolean) {
    setSavedAt(null);
    setSelected((prev) => {
      const next = new Set(prev);
      if (shiftKey && lastClicked) {
        // Fill the run between the anchor and this day, inclusive. The anchor's
        // resulting state decides whether the run is added or cleared, so a
        // shift-click reads as "extend what I just did".
        const a = parseIso(lastClicked);
        const b = parseIso(iso);
        const from = a <= b ? a : b;
        const to = a <= b ? b : a;
        const adding = !prev.has(iso);
        for (let d = new Date(from); d <= to; d = addDays(d, 1)) {
          const key = toIso(d);
          if (d < today || d > windowEnd) continue;
          if (adding) next.add(key);
          else next.delete(key);
        }
      } else if (next.has(iso)) {
        next.delete(iso);
      } else {
        next.add(iso);
      }
      return next;
    });
    setLastClicked(iso);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    // Mirror the server guards, first failure wins.
    const dates = Array.from(selected);
    if (dates.length > MAX_BLACKOUT_DATES) {
      setError(`Select at most ${MAX_BLACKOUT_DATES} blackout dates.`);
      return;
    }
    const seen = new Set<string>();
    for (const iso of dates) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || Number.isNaN(parseIso(iso).getTime())) {
        setError(`${iso} is not a valid date.`);
        return;
      }
      if (seen.has(iso)) {
        setError(`${iso} is selected twice.`);
        return;
      }
      seen.add(iso);
    }

    setError(null);
    setSaving(true);
    try {
      const saved = await updatePlanRules({
        ...initial,
        blackoutDates: dates.sort(),
      });
      setSelected(new Set(saved.blackoutDates ?? []));
      setSavedAt(Date.now());
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not save blackout dates.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-8 rounded-panel border border-sand-200 px-8 py-8">
      <section className="grid gap-3 sm:grid-cols-[180px_1fr]">
        <div>
          <div className="text-sm font-medium text-ink-900">Blackout dates</div>
          <div className="mt-1 text-xs text-ink-400 leading-snug">
            Blackout dates apply to the nights your guest is staying, not the day
            they book. If any night of a stay falls on a blackout date, no plan
            is offered for that stay.
          </div>
          <div className="mt-3 text-xs font-medium text-ink-700">
            {selected.size} {selected.size === 1 ? "day" : "days"} selected
          </div>
          <div className="mt-1 text-xs text-ink-400 leading-snug">
            Click a day to toggle it. Shift-click to select a run of days.
          </div>
        </div>

        <div className="max-h-96 overflow-y-auto rounded-md border border-sand-200 p-3">
          <div className="space-y-5">
            {months.map((month) => (
              <div key={month.key}>
                <div className="text-xs font-semibold text-ink-700">
                  {month.label}
                </div>
                <div className="mt-2 grid grid-cols-7 gap-1">
                  {WEEKDAYS.map((w, i) => (
                    <div
                      key={`${month.key}-wd-${i}`}
                      className="text-center text-[10px] text-ink-400"
                    >
                      {w}
                    </div>
                  ))}
                  {Array.from({ length: month.lead }).map((_, i) => (
                    <div key={`${month.key}-lead-${i}`} />
                  ))}
                  {month.days.map((d) => {
                    const isSelected = selected.has(d.iso);
                    return (
                      <button
                        key={d.iso}
                        type="button"
                        disabled={!d.selectable}
                        aria-pressed={isSelected}
                        aria-label={d.iso}
                        onClick={(ev) => toggle(d.iso, ev.shiftKey)}
                        className={`h-7 rounded text-xs tabular-nums transition ${
                          !d.selectable
                            ? "cursor-default text-ink-300"
                            : isSelected
                              ? "border border-brand-violet bg-brand-violet-tint font-medium text-brand-violet"
                              : "text-ink-700 hover:bg-sand-100"
                        }`}
                      >
                        {d.day}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {error ? (
        <div className="text-base text-red-700" role="alert">
          {error}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-sand-100 pt-6">
        <div className="text-[17px] text-ink-400">
          {savedAt ? "Blackout dates saved" : "Guests see no plan option on these stays."}
        </div>
        <button type="submit" disabled={saving} className={saveButtonClassName}>
          {saving ? "Saving" : "Save blackout dates"}
        </button>
      </div>
    </form>
  );
}
