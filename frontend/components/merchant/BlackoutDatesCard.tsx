"use client";

import { useMemo, useState } from "react";
import { updatePlanRules, type PlanRules } from "@/lib/api";
import {
  addDaysIso,
  firstDayOfWeek,
  formatPlainDate,
  plainDateToUtc,
  todayIn,
  utcToPlainDate,
} from "@/lib/money";

// Rolling window the merchant can pick from: today through today + 365 days.
const WINDOW_DAYS = 365;
// Mirrors MAX_BLACKOUT_DATES in PlanRulesResource.
const MAX_BLACKOUT_DATES = 400;

// Calendar dates are YYYY-MM-DD strings throughout, with arithmetic and
// weekday reads on UTC midnights (lib/money), so neither the browser's zone nor
// a DST change can move a day. "Today" is the property's today.

type MonthGrid = {
  key: string;
  label: string;
  // Leading blanks so the 1st lands under its real weekday column.
  lead: number;
  days: { iso: string; day: number; selectable: boolean }[];
};

function buildMonths(
  from: string,
  to: string,
  locale: string | null,
  firstDay: number,
): MonthGrid[] {
  const months: MonthGrid[] = [];
  const start = plainDateToUtc(from);
  if (!start) return months;
  let year = start.getUTCFullYear();
  let month = start.getUTCMonth();
  for (;;) {
    const firstIso = utcToPlainDate(new Date(Date.UTC(year, month, 1)));
    if (firstIso > to) break;
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const days: MonthGrid["days"] = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = utcToPlainDate(new Date(Date.UTC(year, month, d)));
      days.push({ iso, day: d, selectable: iso >= from && iso <= to });
    }
    // ISO weekday of the 1st (1 = Monday ... 7 = Sunday), offset by the
    // locale's first day of the week.
    const isoWeekday = new Date(Date.UTC(year, month, 1)).getUTCDay() || 7;
    months.push({
      key: `${year}-${month}`,
      label: formatPlainDate(firstIso, locale, { month: "long", year: "numeric" }),
      lead: (isoWeekday - firstDay + 7) % 7,
      days,
    });
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }
  return months;
}

/** Narrow weekday initials in the locale, starting on its first day of the week. */
function weekdayHeaders(locale: string | null, firstDay: number): string[] {
  const fmt = new Intl.DateTimeFormat(locale || "en", { weekday: "narrow", timeZone: "UTC" });
  // 2024-01-01 was a Monday (ISO weekday 1).
  return Array.from({ length: 7 }, (_, i) => {
    const isoWeekday = ((firstDay - 1 + i) % 7) + 1;
    return fmt.format(new Date(Date.UTC(2024, 0, isoWeekday)));
  });
}

export function BlackoutDatesCard({
  initial,
  saveButtonClassName = "btn-primary-merchant",
  locale,
  timeZone,
}: {
  initial: PlanRules;
  saveButtonClassName?: string;
  /** The property's locale (month names, week start) and zone (its today). */
  locale: string | null;
  timeZone: string | null;
}) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(initial.blackoutDates ?? []),
  );
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Anchor for shift-click range selection.
  const [lastClicked, setLastClicked] = useState<string | null>(null);

  const today = useMemo(() => todayIn(timeZone), [timeZone]);
  const windowEnd = useMemo(() => addDaysIso(today, WINDOW_DAYS), [today]);
  const firstDay = useMemo(() => firstDayOfWeek(locale), [locale]);
  const months = useMemo(
    () => buildMonths(today, windowEnd, locale, firstDay),
    [today, windowEnd, locale, firstDay],
  );
  const weekdays = useMemo(() => weekdayHeaders(locale, firstDay), [locale, firstDay]);

  function toggle(iso: string, shiftKey: boolean) {
    setSavedAt(null);
    setSelected((prev) => {
      const next = new Set(prev);
      if (shiftKey && lastClicked) {
        // Fill the run between the anchor and this day, inclusive. The anchor's
        // resulting state decides whether the run is added or cleared, so a
        // shift-click reads as "extend what I just did".
        const from = lastClicked <= iso ? lastClicked : iso;
        const to = lastClicked <= iso ? iso : lastClicked;
        const adding = !prev.has(iso);
        for (let d = from; d <= to; d = addDaysIso(d, 1)) {
          if (d < today || d > windowEnd) continue;
          if (adding) next.add(d);
          else next.delete(d);
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
      if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || plainDateToUtc(iso) === null) {
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
    // No Panel of its own: PaymentSettingsTabs is the card now, and this is the
    // section it reveals. Drawing one here would nest a white card inside a
    // white card. Padding comes from the tab card too, so only the form's own
    // row rhythm survives.
    <div className="flex flex-col gap-6">
      {/* No heading: the tab row above IS this card's head, and the active tab
          already says "Blackout dates". A heading here repeated it verbatim. */}
    <form onSubmit={handleSubmit} className="flex flex-col gap-8">
      <section className="grid gap-3 sm:grid-cols-[180px_1fr]">
        <div>
          <div className="text-[13px] text-ink-900">Blackout dates</div>
          <div className="mt-1 text-[13px] text-ink-500 leading-[1.4]">
            Blackout dates apply to the nights your guest is staying, not the day
            they book. If any night of a stay falls on a blackout date, no plan
            is offered for that stay.
          </div>
          <div className="mt-3 text-[13px] text-ink-900">
            {selected.size} {selected.size === 1 ? "day" : "days"} selected
          </div>
          <div className="mt-1 text-[13px] text-ink-500 leading-[1.4]">
            Click a day to toggle it. Shift-click to select a run of days.
          </div>
        </div>

        <div className="max-h-96 overflow-y-auto rounded-md border border-sand-200 bg-white p-3">
          <div className="space-y-5">
            {months.map((month) => (
              <div key={month.key}>
                <div className="text-[13px] font-semibold text-ink-900">
                  {month.label}
                </div>
                <div className="mt-2 grid grid-cols-7 gap-1">
                  {weekdays.map((w, i) => (
                    <div
                      key={`${month.key}-wd-${i}`}
                      className="text-center text-[10px] text-ink-500"
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
                        aria-label={formatPlainDate(d.iso, locale, {
                          weekday: "long",
                          day: "numeric",
                          month: "long",
                          year: "numeric",
                        })}
                        onClick={(ev) => toggle(d.iso, ev.shiftKey)}
                        className={`h-7 rounded text-[13px] tabular-nums transition ${
                          !d.selectable
                            ? "cursor-default text-ink-300"
                            : isSelected
                              ? "border border-brand-violet bg-brand-violet-tint font-medium text-brand-violet"
                              : "text-ink-900 hover:bg-sand-100"
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
        <div className="text-[14px] text-red-700" role="alert">
          {error}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-sand-100 pt-6">
        <div className="text-[14px] text-ink-500">
          {savedAt ? "Blackout dates saved" : "Guests see no plan option on these stays."}
        </div>
        <button type="submit" disabled={saving} className={saveButtonClassName}>
          {saving ? "Saving" : "Save blackout dates"}
        </button>
      </div>
    </form>
    </div>
  );
}
