// Mirror of backend PlanEligibilityService for live UX preview on the booking
// creation form. CLAUDE.md: backend is source of truth; backend validates on
// plan creation. This duplicate exists only so merchants see the plan options
// update as they pick an appointment date, without a round-trip per keystroke.

import { DEFAULT_PLAN_RULES, type PlanRules } from "./api";

export type PlanFrequency = "biweekly" | "monthly";

export type PreviewOption = {
  frequency: PlanFrequency;
  numPayments: number;
  perPaymentAmountCents: number;
  finalPaymentAmountCents: number;
  dueDates: string[]; // yyyy-MM-dd
  recommended: boolean;
};

export type PreviewReason =
  | "ok"
  | "too_close"
  | "too_far"
  | "amount_too_low"
  | "amount_too_high"
  | "no_plan_fits"
  | "invalid_input";

export type PreviewResult = {
  eligible: boolean;
  reason: PreviewReason;
  daysToAppointment: number;
  options: PreviewOption[];
};

const FREQUENCY_DAYS: Record<PlanFrequency, number> = {
  biweekly: 14,
  monthly: 30,
};

const MIN_FINAL_PAYMENT_BUFFER_DAYS = 3;

export function previewEligibility(
  today: Date,
  appointmentDate: Date | null,
  totalAmountCents: number,
  rules: PlanRules = DEFAULT_PLAN_RULES,
): PreviewResult {
  if (!appointmentDate || Number.isNaN(appointmentDate.getTime())) {
    return { eligible: false, reason: "invalid_input", daysToAppointment: 0, options: [] };
  }
  const days = daysBetween(today, appointmentDate);
  const weeks = Math.floor(days / 7);

  if (weeks < rules.minLeadTimeWeeks) {
    return { eligible: false, reason: "too_close", daysToAppointment: days, options: [] };
  }
  if (rules.maxLeadTimeWeeks != null && weeks > rules.maxLeadTimeWeeks) {
    return { eligible: false, reason: "too_far", daysToAppointment: days, options: [] };
  }
  if (
    rules.minBookingAmountCents != null &&
    totalAmountCents > 0 &&
    totalAmountCents < rules.minBookingAmountCents
  ) {
    return { eligible: false, reason: "amount_too_low", daysToAppointment: days, options: [] };
  }
  if (
    rules.maxBookingAmountCents != null &&
    totalAmountCents > rules.maxBookingAmountCents
  ) {
    return { eligible: false, reason: "amount_too_high", daysToAppointment: days, options: [] };
  }

  const allowedFrequencies: PlanFrequency[] =
    rules.allowedFrequencies === "monthly"
      ? ["monthly"]
      : rules.allowedFrequencies === "biweekly"
        ? ["biweekly"]
        : ["biweekly", "monthly"];

  const recommended = resolveRecommended(rules);

  const options = allowedFrequencies
    .map((f) => buildOption(today, appointmentDate, totalAmountCents, f))
    .filter((o): o is Omit<PreviewOption, "recommended"> => o !== null)
    .map((o) => ({ ...o, recommended: recommended != null && o.frequency === recommended }));

  if (options.length === 0) {
    return { eligible: false, reason: "no_plan_fits", daysToAppointment: days, options: [] };
  }

  return { eligible: true, reason: "ok", daysToAppointment: days, options };
}

function resolveRecommended(rules: PlanRules): PlanFrequency | null {
  if (rules.allowedFrequencies !== "both") return null;
  if (rules.recommendedFrequency != null) return rules.recommendedFrequency;
  return "monthly";
}

function buildOption(
  today: Date,
  appointmentDate: Date,
  totalAmountCents: number,
  frequency: PlanFrequency,
): Omit<PreviewOption, "recommended"> | null {
  const days = daysBetween(today, appointmentDate);
  const intervalDays = FREQUENCY_DAYS[frequency];
  const usable = days - MIN_FINAL_PAYMENT_BUFFER_DAYS;
  if (usable < 0) return null;
  const intervals = Math.floor(usable / intervalDays);
  const numPayments = 1 + intervals;
  if (numPayments < 2) return null;

  let perPayment = 0;
  let finalPayment = 0;
  if (totalAmountCents > 0) {
    perPayment = Math.floor(totalAmountCents / numPayments);
    const remainder = totalAmountCents - perPayment * numPayments;
    finalPayment = perPayment + remainder;
  }

  const dueDates: string[] = [];
  for (let i = 0; i < numPayments; i++) {
    dueDates.push(formatDate(addDays(today, i * intervalDays)));
  }

  return {
    frequency,
    numPayments,
    perPaymentAmountCents: perPayment,
    finalPaymentAmountCents: finalPayment,
    dueDates,
  };
}

function daysBetween(a: Date, b: Date): number {
  const aUtc = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const bUtc = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.floor((bUtc - aUtc) / (1000 * 60 * 60 * 24));
}

function addDays(d: Date, n: number): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + n);
  return next;
}

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function formatCents(cents: number): string {
  return (cents / 100).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
  });
}

export function formatScheduleDate(iso: string): string {
  // iso is yyyy-MM-dd. Parse as local date to avoid timezone drift.
  const parts = iso.split("-").map(Number);
  const y = parts[0] ?? 0;
  const m = parts[1] ?? 1;
  const d = parts[2] ?? 1;
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
