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
  originalTotalAmountCents: number;
  discountedTotalAmountCents: number;
  options: PreviewOption[];
};

const FREQUENCY_DAYS: Record<PlanFrequency, number> = {
  biweekly: 14,
  monthly: 30,
};

const MIN_FINAL_PAYMENT_BUFFER_DAYS = 3;

// Monthly only: the first installment (payment 2) must be at least this many
// days after the booking date, else it skips to the following month so it
// isn't a same-week double charge against the immediate payment 1. Mirrors
// PlanEligibilityService.MONTHLY_FIRST_INSTALLMENT_MIN_GAP_DAYS.
const MONTHLY_FIRST_INSTALLMENT_MIN_GAP_DAYS = 14;

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
      originalTotalAmountCents: totalAmountCents,
      discountedTotalAmountCents: totalAmountCents,
      options: [],
    };
  }
  const days = daysBetween(today, appointmentDate);
  const weeks = Math.floor(days / 7);
  const discountedTotal = applyDiscountCents(totalAmountCents, rules);

  if (weeks < rules.minLeadTimeWeeks) {
    return ineligible("too_close", days, 0, totalAmountCents, discountedTotal);
  }
  if (rules.maxLeadTimeWeeks != null && weeks > rules.maxLeadTimeWeeks) {
    return ineligible("too_far", days, 0, totalAmountCents, discountedTotal);
  }
  if (
    rules.minBookingAmountCents != null &&
    totalAmountCents > 0 &&
    totalAmountCents < rules.minBookingAmountCents
  ) {
    return ineligible("amount_too_low", days, 0, totalAmountCents, discountedTotal);
  }
  if (
    rules.maxBookingAmountCents != null &&
    totalAmountCents > rules.maxBookingAmountCents
  ) {
    return ineligible("amount_too_high", days, 0, totalAmountCents, discountedTotal);
  }

  const deposit = computeDepositCents(discountedTotal, rules);
  if (deposit > 0 && deposit >= discountedTotal) {
    return ineligible("deposit_too_high", days, deposit, totalAmountCents, discountedTotal);
  }
  const installmentTotal = discountedTotal - deposit;
  const hasDeposit = deposit > 0;

  const allowedFrequencies: PlanFrequency[] =
    rules.allowedFrequencies === "monthly"
      ? ["monthly"]
      : rules.allowedFrequencies === "biweekly"
        ? ["biweekly"]
        : ["biweekly", "monthly"];

  const recommended = resolveRecommended(rules);
  const dueOffsetDays = paymentDueOffsetDays(rules);

  const options = allowedFrequencies
    .map((f) => buildInstallments(today, appointmentDate, installmentTotal, hasDeposit, f, dueOffsetDays))
    .filter((o): o is Omit<PreviewOption, "recommended"> => o !== null)
    .map((o) => ({ ...o, recommended: recommended != null && o.frequency === recommended }));

  if (options.length === 0) {
    return ineligible("no_plan_fits", days, deposit, totalAmountCents, discountedTotal);
  }

  return {
    eligible: true,
    reason: "ok",
    daysToAppointment: days,
    depositAmountCents: deposit,
    originalTotalAmountCents: totalAmountCents,
    discountedTotalAmountCents: discountedTotal,
    options,
  };
}

function ineligible(
  reason: PreviewReason,
  daysToAppointment: number,
  depositAmountCents: number,
  originalTotalAmountCents: number,
  discountedTotalAmountCents: number,
): PreviewResult {
  return {
    eligible: false,
    reason,
    daysToAppointment,
    depositAmountCents,
    originalTotalAmountCents,
    discountedTotalAmountCents,
    options: [],
  };
}

function applyDiscountCents(totalCents: number, rules: PlanRules): number {
  const bp = rules.discountBasisPoints;
  if (bp <= 0 || totalCents <= 0) return totalCents;
  return Math.floor((totalCents * (10_000 - bp)) / 10_000);
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

// How many days before the appointment all installments must clear by.
// Returns 0 for the default "due at appointment" policy. Mirrors
// PaymentDuePolicy.offsetDays / MerchantPlanRules.paymentDueOffsetDays on the
// backend. The eligibility math combines this with the 3-day retry buffer.
function paymentDueOffsetDays(rules: PlanRules): number {
  switch (rules.paymentDuePolicy) {
    case "at_appointment":
      return 0;
    case "one_week_before":
      return 7;
    case "one_month_before":
      return 30;
    case "custom_months":
      return (rules.paymentDueCustomMonths ?? 0) * 30;
  }
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
  paymentDueOffsetDays: number,
): Omit<PreviewOption, "recommended"> | null {
  const days = daysBetween(today, appointmentDate);
  const intervalDays = FREQUENCY_DAYS[frequency];
  // The merchant's "all payments due by X days before appointment" rule is a
  // tighter version of the system 3-day retry buffer. Whichever is larger
  // wins. Mirrors PlanEligibilityService.buildInstallments.
  const effectiveBuffer = Math.max(MIN_FINAL_PAYMENT_BUFFER_DAYS, paymentDueOffsetDays);
  const usable = days - effectiveBuffer;
  if (usable < 0) return null;

  let dueDates: string[];
  if (frequency === "monthly") {
    // Monthly: payment 1 is the immediate charge on the booking date itself
    // (NOT business-day shifted). Payments 2..N collect on a fixed monthly
    // anchor (the 2nd or 16th, chosen by booking date), each resolved through
    // the weekend roll-forward. See monthlyDueDates for the anchor rule.
    const cutoff = addDays(appointmentDate, -effectiveBuffer);
    dueDates = monthlyDueDates(today, cutoff, hasDeposit);
    if (dueDates.length === 0) return null;
    if (!hasDeposit && dueDates.length < 2) return null;
  } else {
    const intervals = Math.floor(usable / intervalDays);
    const n = hasDeposit ? intervals : 1 + intervals;
    if (n < 1) return null;
    if (!hasDeposit && n < 2) return null;
    dueDates = [];
    const startMultiplier = hasDeposit ? 1 : 0;
    for (let i = 0; i < n; i++) {
      dueDates.push(formatDate(rollForwardToWeekday(addDays(today, (startMultiplier + i) * intervalDays))));
    }
  }

  const numPayments = dueDates.length;
  if (numPayments < 1) return null;
  if (installmentTotalCents <= 0) return null;

  const perPayment = Math.floor(installmentTotalCents / numPayments);
  const remainder = installmentTotalCents - perPayment * numPayments;
  const finalPayment = perPayment + remainder;

  return {
    frequency,
    numPayments,
    perPaymentAmountCents: perPayment,
    finalPaymentAmountCents: finalPayment,
    dueDates,
  };
}

// Mirrors PlanEligibilityService.monthlyDueDates. Payment 1 is the immediate
// charge on the booking date (no anchor logic) but rolled forward off weekends
// like every charge, included only when there is no separate deposit.
// Installments collect on a fixed monthly anchor (the 2nd or the 16th, chosen by
// booking day); payment 2 is the first anchor occurrence at least
// MONTHLY_FIRST_INSTALLMENT_MIN_GAP_DAYS days after the booking, and payments
// 3..N advance one month at a time on the same anchor. Each anchor date is
// resolved through the weekend roll-forward.
function monthlyDueDates(today: Date, cutoff: Date, hasDeposit: boolean): string[] {
  const dates: string[] = [];
  if (!hasDeposit) {
    dates.push(formatDate(rollForwardToWeekday(today)));
  }
  const anchorDay = monthlyAnchorDay(today.getDate());
  let cursor = new Date(today.getFullYear(), today.getMonth(), anchorDay);
  while (daysBetween(today, cursor) < MONTHLY_FIRST_INSTALLMENT_MIN_GAP_DAYS) {
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, anchorDay);
  }
  for (
    ;
    ;
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, anchorDay)
  ) {
    const due = rollForwardToWeekday(cursor);
    if (due.getTime() > cutoff.getTime()) break;
    dates.push(formatDate(due));
  }
  return dates;
}

// The fixed monthly collection anchor (day of month), chosen by the booking's
// day of month: day 1-10 or 26-end -> the 2nd; day 11-25 -> the 16th. Mirrors
// PlanEligibilityService.monthlyAnchorDay.
function monthlyAnchorDay(bookingDayOfMonth: number): number {
  return bookingDayOfMonth >= 11 && bookingDayOfMonth <= 25 ? 16 : 2;
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

// Weekday-only rule (mirrors PlanEligibilityService.rollForwardToWeekday on the
// backend): no payment may land on a weekend. Saturday and Sunday both roll
// FORWARD to the following Monday; weekdays are returned unchanged. Never rolls
// backward, so an adjusted date is never earlier than its computed date.
function rollForwardToWeekday(d: Date): Date {
  const day = d.getDay(); // 0 = Sunday, 6 = Saturday
  if (day === 6) return addDays(d, 2);
  if (day === 0) return addDays(d, 1);
  return d;
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
