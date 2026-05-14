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
  | "deposit_too_high"
  | "no_plan_fits"
  | "invalid_input";

export type PreviewResult = {
  eligible: boolean;
  reason: PreviewReason;
  daysToAppointment: number;
  depositAmountCents: number;
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
    return {
      eligible: false,
      reason: "invalid_input",
      daysToAppointment: 0,
      depositAmountCents: 0,
      options: [],
    };
  }
  const days = daysBetween(today, appointmentDate);
  const weeks = Math.floor(days / 7);

  if (weeks < rules.minLeadTimeWeeks) {
    return ineligible("too_close", days, 0);
  }
  if (rules.maxLeadTimeWeeks != null && weeks > rules.maxLeadTimeWeeks) {
    return ineligible("too_far", days, 0);
  }
  if (
    rules.minBookingAmountCents != null &&
    totalAmountCents > 0 &&
    totalAmountCents < rules.minBookingAmountCents
  ) {
    return ineligible("amount_too_low", days, 0);
  }
  if (
    rules.maxBookingAmountCents != null &&
    totalAmountCents > rules.maxBookingAmountCents
  ) {
    return ineligible("amount_too_high", days, 0);
  }

  const deposit = computeDepositCents(totalAmountCents, rules);
  if (deposit > 0 && deposit >= totalAmountCents) {
    return ineligible("deposit_too_high", days, deposit);
  }
  const installmentTotal = totalAmountCents - deposit;
  const hasDeposit = deposit > 0;

  const allowedFrequencies: PlanFrequency[] =
    rules.allowedFrequencies === "monthly"
      ? ["monthly"]
      : rules.allowedFrequencies === "biweekly"
        ? ["biweekly"]
        : ["biweekly", "monthly"];

  const recommended = resolveRecommended(rules);

  const options = allowedFrequencies
    .map((f) => buildInstallments(today, appointmentDate, installmentTotal, hasDeposit, f))
    .filter((o): o is Omit<PreviewOption, "recommended"> => o !== null)
    .map((o) => ({ ...o, recommended: recommended != null && o.frequency === recommended }));

  if (options.length === 0) {
    return ineligible("no_plan_fits", days, deposit);
  }

  return {
    eligible: true,
    reason: "ok",
    daysToAppointment: days,
    depositAmountCents: deposit,
    options,
  };
}

function ineligible(
  reason: PreviewReason,
  daysToAppointment: number,
  depositAmountCents: number,
): PreviewResult {
  return { eligible: false, reason, daysToAppointment, depositAmountCents, options: [] };
}

export function computeDepositCents(totalCents: number, rules: PlanRules): number {
  if (!rules.depositRequired || rules.depositType == null || rules.depositValue == null) {
    return 0;
  }
  let raw =
    rules.depositType === "percentage"
      ? Math.floor((totalCents * rules.depositValue) / 100)
      : rules.depositValue;
  if (rules.depositMaxCents != null) raw = Math.min(raw, rules.depositMaxCents);
  return Math.max(0, Math.min(raw, totalCents));
}

function resolveRecommended(rules: PlanRules): PlanFrequency | null {
  if (rules.allowedFrequencies !== "both") return null;
  if (rules.recommendedFrequency != null) return rules.recommendedFrequency;
  return "monthly";
}

function buildInstallments(
  today: Date,
  appointmentDate: Date,
  installmentTotalCents: number,
  hasDeposit: boolean,
  frequency: PlanFrequency,
): Omit<PreviewOption, "recommended"> | null {
  const days = daysBetween(today, appointmentDate);
  const intervalDays = FREQUENCY_DAYS[frequency];
  const usable = days - MIN_FINAL_PAYMENT_BUFFER_DAYS;
  if (usable < 0) return null;
  const intervals = Math.floor(usable / intervalDays);
  const numPayments = hasDeposit ? intervals : 1 + intervals;
  if (numPayments < 1) return null;
  if (!hasDeposit && numPayments < 2) return null;
  if (installmentTotalCents <= 0) return null;

  const perPayment = Math.floor(installmentTotalCents / numPayments);
  const remainder = installmentTotalCents - perPayment * numPayments;
  const finalPayment = perPayment + remainder;

  const dueDates: string[] = [];
  const startMultiplier = hasDeposit ? 1 : 0;
  for (let i = 0; i < numPayments; i++) {
    dueDates.push(formatDate(addDays(today, (startMultiplier + i) * intervalDays)));
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
