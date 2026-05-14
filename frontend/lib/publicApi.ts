// Public, unauthenticated API for the hosted consumer page (pay.bliss.com).
// No cookies are sent; the booking_token in the URL is the auth grant.

import { API_BASE_URL } from "./api";

export type PublicPlanFrequency = "biweekly" | "monthly";

export type PublicPlanOption = {
  frequency: PublicPlanFrequency;
  numPayments: number;
  perPaymentAmountCents: number;
  finalPaymentAmountCents: number;
  dueDates: string[]; // yyyy-MM-dd
  recommended: boolean;
};

export type PublicPolicies = {
  refundPolicy:
    | "full"
    | "none"
    | "first_installment_only"
    | "sliding_scale"
    | "credit_only";
  refundSlidingThresholdPercent: number | null;
  cancellationFeeEnabled: boolean;
  cancellationFeeType: "fixed" | "percentage" | null;
  cancellationFeeValue: number | null;
  cancellationFeeThresholdPercent: number | null;
  paymentDuePolicy:
    | "at_appointment"
    | "one_week_before"
    | "one_month_before"
    | "custom_months";
  paymentDueCustomMonths: number | null;
  retryAttempts: number;
  retrySpacingDays: number;
  lateFeeEnabled: boolean;
  lateFeeType: "fixed" | "percentage" | null;
  lateFeeValue: number | null;
  lateFeeScope: "per_failure" | "once_per_plan" | null;
  afterRetriesAction: "treat_as_cancellation" | "balance_due_at_checkin";
};

export type PublicBooking = {
  merchant: {
    slug: string;
    businessName: string;
    businessType: string;
    brandColorPrimary: string | null;
    logoUrl: string | null;
    contactEmail: string;
  };
  service: {
    name: string;
    description: string | null;
    totalAmountCents: number;
    appointmentDate: string;
    cancellationPolicy: string | null;
    customerNameHint: string | null;
    customerEmailHint: string | null;
  };
  eligibility: {
    eligible: boolean;
    reason: string;
    daysToAppointment: number;
    depositAmountCents: number;
  };
  planOptions: PublicPlanOption[];
  stripe: {
    configured: boolean;
    publishableKey: string | null;
  };
  policies: PublicPolicies;
  status: string;
};

export async function fetchPublicBooking(
  slug: string,
  token: string,
): Promise<PublicBooking | null> {
  const res = await fetch(
    `${API_BASE_URL}/api/v1/public/bookings/${encodeURIComponent(slug)}/${encodeURIComponent(token)}`,
    { cache: "no-store" },
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`fetchPublicBooking failed: ${res.status}`);
  }
  return (await res.json()) as PublicBooking;
}

export type CreatePlanRequest = {
  merchantSlug: string;
  bookingToken: string;
  customerEmail: string;
  customerFirstName?: string;
  customerLastName?: string;
  paymentMethodId: string;
  frequency: PublicPlanFrequency;
};

export type ScheduleKind = "deposit" | "installment";

export type CreatePlanResponse = {
  planId: string;
  bookingId: string;
  frequency: PublicPlanFrequency;
  numPayments: number;
  totalAmountCents: number;
  depositAmountCents: number;
  schedule: {
    sequence: number;
    dueDate: string;
    amountCents: number;
    status: string;
    kind: ScheduleKind;
  }[];
  firstChargeIntentId: string;
  firstChargeStatus: string;
};

export type CreatePlanError = {
  error: string;
  message: string;
};

export async function createPlan(
  payload: CreatePlanRequest,
): Promise<{ ok: true; data: CreatePlanResponse } | { ok: false; error: CreatePlanError; status: number }> {
  const res = await fetch(`${API_BASE_URL}/api/v1/public/plans`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      error: {
        error: (body as { error?: string }).error ?? "unknown_error",
        message:
          (body as { message?: string }).message ??
          `Could not create plan (${res.status})`,
      },
    };
  }
  return { ok: true, data: body as CreatePlanResponse };
}

export function formatScheduleDateLong(iso: string): string {
  const parts = iso.split("-").map(Number);
  const y = parts[0] ?? 0;
  const m = parts[1] ?? 1;
  const d = parts[2] ?? 1;
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export function formatScheduleDateShort(iso: string): string {
  const parts = iso.split("-").map(Number);
  const y = parts[0] ?? 0;
  const m = parts[1] ?? 1;
  const d = parts[2] ?? 1;
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function formatScheduleDatePill(iso: string): string {
  // 9px uppercase per spec: "MAY 1" form.
  return formatScheduleDateShort(iso).toUpperCase();
}

export function formatDollars(cents: number): string {
  return (cents / 100).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
  });
}

export function formatDollarsCompact(cents: number): string {
  // No decimals when even.
  if (cents % 100 === 0) {
    return `$${(cents / 100).toLocaleString()}`;
  }
  return formatDollars(cents);
}
