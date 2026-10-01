// Single frontend source of truth for formatting money and dates.
//
// Every amount on the wire is an integer in MINOR UNITS of an ISO 4217
// currency (cents for USD/GBP/EUR, whole yen for JPY, thousandths for KWD),
// whatever the field is called (`*Cents` is historical). Payloads that carry
// amounts also carry `currency`, `locale` and `timeZone`; pass those here.
//
// There is no default currency. A missing currency is a bug upstream, so the
// helpers throw rather than quietly rendering dollars.
//
// A null locale means plain English ("en"), not US English, mirroring the
// backend's PropertyLocale. A null time zone means UTC (pre-V36 rows).

export type MoneyContext = { currency: string; locale?: string | null };

const DEFAULT_LOCALE = "en";

function localeOrDefault(locale: string | null | undefined): string {
  return locale && locale.trim() ? locale : DEFAULT_LOCALE;
}

function requireCurrency(currency: string | null | undefined): string {
  if (!currency || !currency.trim()) {
    throw new Error("money: a currency code is required");
  }
  return currency.trim().toUpperCase();
}

const digitsCache = new Map<string, number>();

/** Minor-unit digits of an ISO 4217 code: 2 for USD, 0 for JPY, 3 for KWD. */
export function minorDigits(currency: string): number {
  const code = requireCurrency(currency);
  const cached = digitsCache.get(code);
  if (cached !== undefined) return cached;
  const d = new Intl.NumberFormat("en", { style: "currency", currency: code })
    .resolvedOptions().maximumFractionDigits ?? 2;
  digitsCache.set(code, d);
  return d;
}

function currencyFormatter(
  ctx: MoneyContext,
  fractionDigits: number,
): Intl.NumberFormat {
  return new Intl.NumberFormat(localeOrDefault(ctx.locale), {
    style: "currency",
    currency: requireCurrency(ctx.currency),
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

/**
 * Major-unit number for Intl. Division by a power of ten is exact enough here:
 * the result is only rendered, never fed back into arithmetic.
 */
function toMajor(minor: number, digits: number): number {
  return minor / 10 ** digits;
}

/** "£1,234.56" (GBP en-GB), "￥12,000" (JPY ja-JP), "KWD 12.345". */
export function formatMoney(minor: number, ctx: MoneyContext): string {
  const d = minorDigits(ctx.currency);
  return currencyFormatter(ctx, d).format(toMajor(minor, d));
}

/** Like formatMoney, but drops the fraction when it is zero: "$4,000", "$4,000.50". */
export function formatMoneyCompact(minor: number, ctx: MoneyContext): string {
  const d = minorDigits(ctx.currency);
  if (d === 0 || minor % 10 ** d === 0) {
    return currencyFormatter(ctx, 0).format(toMajor(minor, d));
  }
  return formatMoney(minor, ctx);
}

/**
 * Parses what a merchant typed into an amount field, in major units of
 * `currency`, into integer minor units. Accepts at most the currency's own
 * decimals (none for JPY, three for KWD), tolerates grouping commas, dots and
 * spaces, a decimal comma ("12,50") and a leading currency symbol. Uses string
 * math so "19.99" is exactly 1999.
 * Returns null for anything else, including negative amounts.
 */
export function parseMoneyInput(text: string, currency: string): number | null {
  const d = minorDigits(currency);
  if (text.includes("-")) return null;
  // Drop spaces (including the narrow no-break space some locales group
  // with) and any leading currency symbol or code.
  let cleaned = text.trim().replace(/[\s  ']/g, "").replace(/^[^\d.,]+/, "");
  if (cleaned === "") return null;
  // Work out which mark is the decimal separator, so "1.234,56" (de-DE) is
  // never misread as 123456 major units:
  // - both marks present: the last one is the decimal, the other groups;
  // - one mark repeated in groups of three ("1,234,567", "1.234.567"): grouping;
  // - a single comma not followed by exactly three digits ("12,5"): decimal;
  // - otherwise a comma groups and a dot is the decimal.
  const hasComma = cleaned.includes(",");
  const hasDot = cleaned.includes(".");
  if (hasComma && hasDot) {
    const decimal = cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".") ? "," : ".";
    const group = decimal === "," ? "." : ",";
    cleaned = cleaned.split(group).join("").replace(decimal, ".");
  } else if (hasComma) {
    if (/^\d{1,3}(,\d{3})+$/.test(cleaned)) cleaned = cleaned.replace(/,/g, "");
    else if (/^\d*,\d*$/.test(cleaned)) cleaned = cleaned.replace(",", ".");
    else return null;
  } else if (hasDot && /^\d{1,3}(\.\d{3}){2,}$/.test(cleaned)) {
    cleaned = cleaned.replace(/\./g, "");
  }
  const match = /^(\d*)(?:\.(\d*))?$/.exec(cleaned);
  if (!match) return null;
  const whole = match[1] ?? "";
  const frac = match[2];
  if (whole === "" && (frac === undefined || frac === "")) return null;
  if (frac !== undefined && frac.length > d) return null;
  const fracPadded = (frac ?? "").padEnd(d, "0");
  const digits = `${whole || "0"}${fracPadded}`.replace(/^0+(?=\d)/, "");
  const value = Number(digits);
  if (!Number.isSafeInteger(value)) return null;
  return value;
}

/** Minor units to an input-field string: "4000.00" for USD, "12000" for JPY. */
export function minorToInput(minor: number, currency: string): string {
  const d = minorDigits(currency);
  const negative = minor < 0;
  const abs = String(Math.abs(Math.trunc(minor)));
  if (d === 0) return `${negative ? "-" : ""}${abs}`;
  const padded = abs.padStart(d + 1, "0");
  const whole = padded.slice(0, padded.length - d);
  const frac = padded.slice(padded.length - d);
  return `${negative ? "-" : ""}${whole}.${frac}`;
}

/** The symbol the locale uses for the currency, for input prefixes: "£", "€", "¥". */
export function currencySymbol(ctx: MoneyContext): string {
  const part = currencyFormatter(ctx, 0)
    .formatToParts(0)
    .find((p) => p.type === "currency");
  return part?.value ?? requireCurrency(ctx.currency);
}

/**
 * Splits `total` minor units into `n` payments: every payment is
 * floor(total / n) and the remainder lands on the LAST one, so the last is never
 * smaller than the others and the parts sum to `total` exactly. This is the
 * backend's rule.
 */
export function splitInstallments(total: number, n: number): number[] {
  if (!Number.isInteger(n) || n <= 0) return [];
  const base = Math.floor(total / n);
  const parts = new Array<number>(n).fill(base);
  parts[n - 1] = total - base * (n - 1);
  return parts;
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/** UTC-midnight Date for a YYYY-MM-DD calendar date, or null when malformed. */
export function plainDateToUtc(isoDate: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!y || !mo || !d) return null;
  return new Date(Date.UTC(y, mo - 1, d));
}

/** YYYY-MM-DD of a UTC-midnight Date (or any Date, read in UTC). */
export function utcToPlainDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const MEDIUM_DATE: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  year: "numeric",
};

/**
 * Formats a YYYY-MM-DD calendar date. It is read as a calendar day, not an
 * instant, and formatted in UTC on a UTC-midnight Date, so no browser zone can
 * shift it by a day. Malformed input is returned unchanged.
 */
export function formatPlainDate(
  isoDate: string,
  locale: string | null | undefined,
  opts: Intl.DateTimeFormatOptions = MEDIUM_DATE,
): string {
  const dt = plainDateToUtc(isoDate);
  if (!dt) return isoDate;
  return dt.toLocaleDateString(localeOrDefault(locale), { ...opts, timeZone: "UTC" });
}

/**
 * Formats a timestamp (createdAt, refundedAt...) in the property's zone. Null
 * zone is UTC. Default shows date and time. Malformed input is returned unchanged.
 */
export function formatInstant(
  iso: string,
  locale: string | null | undefined,
  timeZone: string | null | undefined,
  opts: Intl.DateTimeFormatOptions = {
    ...MEDIUM_DATE,
    hour: "2-digit",
    minute: "2-digit",
  },
): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(localeOrDefault(locale), {
    ...opts,
    timeZone: timeZone || "UTC",
  });
}

/** Today's calendar date (YYYY-MM-DD) in an IANA zone; UTC when null. */
export function todayIn(timeZone: string | null | undefined, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timeZone || "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Calendar-date arithmetic in UTC: YYYY-MM-DD plus n days. */
export function addDaysIso(isoDate: string, n: number): string {
  const d = plainDateToUtc(isoDate);
  if (!d) return isoDate;
  d.setUTCDate(d.getUTCDate() + n);
  return utcToPlainDate(d);
}

/** Whole days from calendar date a to b (negative when b is earlier). */
export function daysBetweenIso(a: string, b: string): number {
  const da = plainDateToUtc(a);
  const db = plainDateToUtc(b);
  if (!da || !db) return NaN;
  return Math.round((db.getTime() - da.getTime()) / 86_400_000);
}

/** First day of the week for a locale, ISO numbering (1 = Monday, 7 = Sunday). */
export function firstDayOfWeek(locale: string | null | undefined): number {
  const tag = localeOrDefault(locale);
  try {
    const loc = new Intl.Locale(tag) as Intl.Locale & {
      getWeekInfo?: () => { firstDay: number };
      weekInfo?: { firstDay: number };
    };
    const info = loc.getWeekInfo?.() ?? loc.weekInfo;
    if (info?.firstDay) return info.firstDay;
  } catch {
    /* fall through */
  }
  return tag.startsWith("en-US") ? 7 : 1;
}
