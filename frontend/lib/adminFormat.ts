/**
 * Formatting shared by the two admin screens. Kept here rather than duplicated
 * so the list and the detail cannot disagree about what a 0 rate means.
 *
 * Nothing here computes a rate. Every rate on these screens comes from the API
 * as a decimal fraction and is only ever rendered.
 */

/** A property with no business name yet is identified by its slug. */
export function propertyName(row: {
  businessName: string | null;
  slug: string;
}): string {
  const name = row.businessName?.trim();
  return name ? name : row.slug;
}

/**
 * 0.05 -> "5%", 0.035 -> "3.5%". Trailing zeros are trimmed so the common case
 * reads as a whole number rather than "5.00%".
 */
export function formatPercent(rate: number): string {
  const pct = rate * 100;
  const rounded = Math.round(pct * 1000) / 1000;
  return `${rounded}%`;
}

/**
 * The rate a property is on right now.
 *
 * Zero and absent are different answers and must not both render as "0%": zero
 * means Bliss charges this property nothing, absent means nobody has set a
 * rate. Plan creation treats them differently too, falling back to 5% only for
 * the absent case.
 */
export function formatFeeRate(rate: number | null): string {
  if (rate === null || rate === undefined) return "Not set";
  if (rate === 0) return "Free";
  return formatPercent(rate);
}

/** Recent-bookings column: a dash when the backend could not recover the rate. */
export function formatDerivedRate(rate: number | null): string {
  if (rate === null || rate === undefined) return "–";
  if (rate === 0) return "Free";
  return formatPercent(rate);
}

/** "2 Sep 2026" from an ISO instant. */
export function formatDate(iso: string | null): string {
  if (!iso) return "–";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "–";
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** "2 Sep 2026, 14:26" — used where the time of day is the point, as on rates. */
export function formatDateTime(iso: string | null): string {
  if (!iso) return "–";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "–";
  return `${formatDate(iso)}, ${d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

/** A bare YYYY-MM-DD, parsed as a calendar date rather than an instant. */
export function formatPlainDate(ymd: string | null): string {
  if (!ymd) return "–";
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return "–";
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** snake_case wire values read as words without inventing a badge palette. */
export function humanize(value: string | null): string {
  if (!value) return "–";
  const spaced = value.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
