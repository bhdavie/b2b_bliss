// Mirror of backend PlanEligibilityService for live UX preview on the booking
// creation form. CLAUDE.md: backend is source of truth; backend validates on
// plan creation. This duplicate exists only so merchants see the plan options
// update as they pick an appointment date, without a round-trip per keystroke.

export type PlanFrequency = "biweekly" | "monthly";

export type PreviewOption = {
  frequency: PlanFrequency;
  numPayments: number;
  perPaymentAmountCents: number;
  finalPaymentAmountCents: number;
  dueDates: string[]; // yyyy-MM-dd
};

export type PreviewResult = {
  eligible: boolean;
  reason: "ok" | "too_close" | "invalid_input";
  daysToAppointment: number;
  options: PreviewOption[];
};

const FREQUENCY_DAYS: Record<PlanFrequency, number> = {
  biweekly: 14,
  monthly: 30,
};

const MIN_FINAL_PAYMENT_BUFFER_DAYS = 3;
const MIN_WEEKS_FOR_PLAN = 6;

export function previewEligibility(
  today: Date,
  appointmentDate: Date | null,
  totalAmountCents: number,
): PreviewResult {
  if (!appointmentDate || Number.isNaN(appointmentDate.getTime())) {
    return { eligible: false, reason: "invalid_input", daysToAppointment: 0, options: [] };
  }
  const days = daysBetween(today, appointmentDate);
  const weeks = Math.floor(days / 7);

  if (weeks < MIN_WEEKS_FOR_PLAN) {
    return { eligible: false, reason: "too_close", daysToAppointment: days, options: [] };
  }

  let frequencies: PlanFrequency[];
  if (weeks <= 7) {
    frequencies = ["biweekly"];
  } else if (weeks <= 12) {
    frequencies = ["biweekly", "monthly"];
  } else {
    frequencies = ["monthly"];
  }

  const options = frequencies
    .map((f) => buildOption(today, appointmentDate, totalAmountCents, f))
    .filter((o): o is PreviewOption => o !== null);

  return { eligible: true, reason: "ok", daysToAppointment: days, options };
}

function buildOption(
  today: Date,
  appointmentDate: Date,
  totalAmountCents: number,
  frequency: PlanFrequency,
): PreviewOption | null {
  const days = daysBetween(today, appointmentDate);
  const intervalDays = FREQUENCY_DAYS[frequency];
  const usable = days - MIN_FINAL_PAYMENT_BUFFER_DAYS;
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
