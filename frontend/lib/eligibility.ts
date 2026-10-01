// Mirror of backend PlanEligibilityService for live UX preview on the booking
// creation form. CLAUDE.md: backend is source of truth; backend validates on
// plan creation. This duplicate exists only so merchants see the plan options
// update as they pick an appointment date, without a round-trip per keystroke.

import { DEFAULT_PLAN_RULES, type PlanRules } from "./api";
import {
  addDaysIso,
  daysBetweenIso,
  formatPlainDate,
  plainDateToUtc,
  splitInstallments,
  utcToPlainDate,
} from "./money";

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
  | "stay_blacked_out"
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

/**
 * A calendar date: a YYYY-MM-DD string (preferred), or a Date read by its
 * local calendar fields (kept so older callers still compile). Either way it
 * is reduced to a calendar day and every computation below runs on UTC
 * midnights, so the browser's zone never moves a date. "Today" must be the
 * property's today (`todayIn(timeZone)` from lib/money), matching the
 * backend's PropertyLocale.today.
 */
export type CalendarDate = string | Date;

/**
 * `departureDate` is the end of the stay. Nullable: bookings.checkout_date is
 * nullable and single-day services have no departure. Consulted only for
 * blackout dates, mirroring PlanEligibilityService.evaluate.
 */
export function previewEligibility(
  todayInput: CalendarDate,
  appointmentInput: CalendarDate | null,
  departureInput: CalendarDate | null,
  totalAmountCents: number,
  rules: PlanRules = DEFAULT_PLAN_RULES,
): PreviewResult {
  const today = toCalendarIso(todayInput);
  const appointmentDate = appointmentInput == null ? null : toCalendarIso(appointmentInput);
  const departureDate = departureInput == null ? null : toCalendarIso(departureInput);
  if (!today || !appointmentDate) {
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

  // Blackout dates before the lead-time checks, mirroring
  // PlanEligibilityService.evaluate: a stay the merchant has closed to plans
  // should not report a lead-time reason.
  if (stayHitsBlackout(appointmentDate, departureDate, rules.blackoutDates ?? [])) {
    return ineligible("stay_blacked_out", days, 0, totalAmountCents, discountedTotal);
  }

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
      // Stored value is days before check-in (field name kept for wire compat).
      return rules.paymentDueCustomMonths ?? 0;
  }
}

function resolveRecommended(rules: PlanRules): PlanFrequency | null {
  if (rules.allowedFrequencies !== "both") return null;
  if (rules.recommendedFrequency != null) return rules.recommendedFrequency;
  return "monthly";
}

function buildInstallments(
  today: string,
  appointmentDate: string,
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
      const due = addDays(today, (startMultiplier + i) * intervalDays);
      // Payment 1 without a deposit is charged at checkout, so it stays today
      // even on a weekend. Mirrors PlanEligibilityService.
      const isPaymentOne = !hasDeposit && i === 0;
      dueDates.push(isPaymentOne ? due : rollForwardToWeekday(due));
    }
  }

  const numPayments = dueDates.length;
  if (numPayments < 1) return null;
  if (installmentTotalCents <= 0) return null;

  const split = splitInstallments(installmentTotalCents, numPayments);
  const perPayment = split[0] ?? 0;
  const finalPayment = split[numPayments - 1] ?? 0;

  return {
    frequency,
    numPayments,
    perPaymentAmountCents: perPayment,
    finalPaymentAmountCents: finalPayment,
    dueDates,
  };
}

// Mirrors PlanEligibilityService.monthlyDueDates. Payment 1 is the immediate
// charge on the booking date (no anchor logic, no weekend roll: checkout takes
// it there and then), included only when there is no separate deposit.
// Installments collect on a fixed monthly anchor (the 2nd or the 16th, chosen by
// booking day); payment 2 is the first anchor occurrence at least
// MONTHLY_FIRST_INSTALLMENT_MIN_GAP_DAYS days after the booking, and payments
// 3..N advance one month at a time on the same anchor. Each anchor date is
// resolved through the weekend roll-forward.
function monthlyDueDates(today: string, cutoff: string, hasDeposit: boolean): string[] {
  const dates: string[] = [];
  if (!hasDeposit) {
    dates.push(today);
  }
  const t = plainDateToUtc(today);
  if (!t) return dates;
  const anchorDay = monthlyAnchorDay(t.getUTCDate());
  let year = t.getUTCFullYear();
  let month = t.getUTCMonth();
  const anchorIso = () => utcToPlainDate(new Date(Date.UTC(year, month, anchorDay)));
  const nextMonth = () => {
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  };
  while (daysBetween(today, anchorIso()) < MONTHLY_FIRST_INSTALLMENT_MIN_GAP_DAYS) {
    nextMonth();
  }
  for (;; nextMonth()) {
    const due = rollForwardToWeekday(anchorIso());
    if (due > cutoff) break;
    dates.push(due);
  }
  return dates;
}

// The fixed monthly collection anchor (day of month), chosen by the booking's
// day of month: day 1-10 or 26-end -> the 2nd; day 11-25 -> the 16th. Mirrors
// PlanEligibilityService.monthlyAnchorDay.
function monthlyAnchorDay(bookingDayOfMonth: number): number {
  return bookingDayOfMonth >= 11 && bookingDayOfMonth <= 25 ? 16 : 2;
}

/**
 * True when any night the stay occupies falls on a blackout date. Mirrors
 * PlanEligibilityService.stayHitsBlackout.
 *
 * Nights occupied run arrival through departure minus one day: the departure day
 * is not a night, the room is free again that day. A stay arriving Dec 22 and
 * departing Dec 26 occupies Dec 22, 23, 24 and 25.
 *
 * A null departure checks the arrival alone rather than guessing a length of
 * stay. An empty blackout list is a no-op.
 *
 * Iteration steps through UTC midnights, the same normalisation daysBetween
 * uses, so a DST boundary inside the stay cannot skip or repeat a night.
 */
function stayHitsBlackout(
  arrival: string,
  departure: string | null,
  blackoutDates: string[],
): boolean {
  if (blackoutDates.length === 0) return false;
  const blacked = new Set(blackoutDates);
  if (!departure || departure <= arrival) return blacked.has(arrival);
  for (let night = arrival; night < departure; night = addDays(night, 1)) {
    if (blacked.has(night)) return true;
  }
  return false;
}

/** Reduces a CalendarDate to YYYY-MM-DD, or null when it is not a date. */
function toCalendarIso(d: CalendarDate): string | null {
  if (typeof d === "string") {
    const utc = plainDateToUtc(d);
    return utc ? utcToPlainDate(utc) : null;
  }
  if (Number.isNaN(d.getTime())) return null;
  return utcToPlainDate(new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())));
}

function daysBetween(a: string, b: string): number {
  return daysBetweenIso(a, b);
}

function addDays(d: string, n: number): string {
  return addDaysIso(d, n);
}

// Weekday-only rule (mirrors PlanEligibilityService.rollForwardToWeekday on the
// backend): no payment may land on a weekend. Saturday and Sunday both roll
// FORWARD to the following Monday; weekdays are returned unchanged. Never rolls
// backward, so an adjusted date is never earlier than its computed date. The
// weekday is read in UTC off a calendar date, so the browser zone is irrelevant.
function rollForwardToWeekday(d: string): string {
  const day = plainDateToUtc(d)?.getUTCDay(); // 0 = Sunday, 6 = Saturday
  if (day === 6) return addDays(d, 2);
  if (day === 0) return addDays(d, 1);
  return d;
}

/** "Jan 15, 2027" / "15 Jan 2027": a schedule due date in the booking's locale. */
export function formatScheduleDate(iso: string, locale: string | null | undefined): string {
  return formatPlainDate(iso, locale, { month: "short", day: "numeric", year: "numeric" });
}
