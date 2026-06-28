// Public, unauthenticated API for the hosted consumer page (pay.bliss.com).
// No cookies are sent; the booking_token in the URL is the auth grant.

import { API_BASE_URL } from "./api";
import { feeFor } from "./blissFee";

/**
 * Customer-facing schedule shape, mirroring how the backend persists rows in
 * {@code PlanCreationService}. The Bliss fee is 5% of the full total (see
 * {@code lib/blissFee.ts}).
 *
 * - With a deposit the fee rides the deposit: {@code todayCents} = baseDeposit
 *   + fee, and installments split (discountedTotal - baseDeposit) cleanly.
 * - With no deposit {@code remainingCents} = discountedTotal + fee and is split
 *   evenly across N installments, matching the backend no-deposit schedule.
 */
export function deriveDisplayAmounts(opts: {
  discountedTotalCents: number;
  originalDepositCents: number;
}) {
  const feeCents = feeFor(opts.discountedTotalCents);
  const totalWithFeeCents = opts.discountedTotalCents + feeCents;
  const depositRate = opts.originalDepositCents / opts.discountedTotalCents;
  const hasDeposit = opts.originalDepositCents > 0;
  const todayCents = hasDeposit ? opts.originalDepositCents + feeCents : 0;
  const remainingCents = totalWithFeeCents - todayCents;
  return { totalWithFeeCents, depositRate, todayCents, remainingCents };
}

/**
 * Split the post-deposit remaining balance evenly across N installments.
 * The first N-1 entries round to the nearest cent; the final entry absorbs
 * any remainder so the sum equals remainingCents exactly.
 */
export function distributeInstallments(opts: {
  remainingCents: number;
  numPayments: number;
}) {
  if (opts.numPayments <= 0) return { perPaymentCents: 0, finalPaymentCents: 0 };
  const perPaymentCents = Math.round(opts.remainingCents / opts.numPayments);
  const finalPaymentCents =
    opts.remainingCents - perPaymentCents * (opts.numPayments - 1);
  return { perPaymentCents, finalPaymentCents };
}

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
    originalTotalAmountCents: number;
    discountedTotalAmountCents: number;
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

/**
 * Superset of {@link PublicPolicies} returned by the merchant lookup
 * endpoint — adds the eligibility-rule fields so the checkout page can
 * mirror the backend's PlanEligibilityService client-side. The booking
 * lookup endpoint only returns the customer-facing subset.
 */
export type MerchantPolicies = PublicPolicies & {
  allowedFrequencies: "monthly" | "biweekly" | "both";
  recommendedFrequency: "monthly" | "biweekly" | null;
  minLeadTimeWeeks: number;
  maxLeadTimeWeeks: number | null;
  minBookingAmountCents: number | null;
  maxBookingAmountCents: number | null;
  depositRequired: boolean;
  depositType: "fixed" | "percentage" | null;
  depositValue: number | null;
  depositMaxCents: number | null;
  discountBasisPoints: number;
};

export type PublicMerchant = {
  merchant: PublicBooking["merchant"];
  policies: MerchantPolicies;
  stripe: {
    configured: boolean;
    publishableKey: string | null;
    chargesEnabled: boolean;
  };
};

export async function fetchPublicMerchant(
  slug: string,
): Promise<PublicMerchant | null> {
  const res = await fetch(
    `${API_BASE_URL}/api/v1/public/merchants/${encodeURIComponent(slug)}`,
    { cache: "no-store" },
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`fetchPublicMerchant failed: ${res.status}`);
  }
  return (await res.json()) as PublicMerchant;
}

export type CheckoutRequest = {
  merchantSlug: string;
  totalAmountCents: number;
  appointmentDate: string;
  checkoutDate?: string | null;
  description?: string | null;
  customerName: string;
  customerEmail: string;
  customerPhone?: string | null;
  paymentMethodId: string;
  frequency: PublicPlanFrequency;
  // Optional card metadata used only by the backend's demo-mode persistence
  // path. The frontend's DemoCardSection sends these so the persisted card
  // row reflects what the customer typed.
  demoCardLastFour?: string | null;
  demoCardExpMonth?: number | null;
  demoCardExpYear?: number | null;
  demoCardBrand?: string | null;
};

export type CheckoutResponse = {
  bookingId: string;
  bookingToken: string;
  planId: string;
  frequency: PublicPlanFrequency;
  numPayments: number;
  totalAmountCents: number;
  originalTotalAmountCents: number | null;
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

export async function submitCheckout(
  payload: CheckoutRequest,
): Promise<{ ok: true; data: CheckoutResponse } | { ok: false; error: CreatePlanError; status: number }> {
  const res = await fetch(`${API_BASE_URL}/api/v1/public/checkout`, {
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
          `Could not create booking (${res.status})`,
      },
    };
  }
  return { ok: true, data: body as CheckoutResponse };
}

export type CreatePlanRequest = {
  merchantSlug: string;
  bookingToken: string;
  customerEmail: string;
  customerFirstName?: string;
  customerLastName?: string;
  paymentMethodId: string;
  frequency: PublicPlanFrequency;
  demoCardLastFour?: string | null;
  demoCardExpMonth?: number | null;
  demoCardExpYear?: number | null;
  demoCardBrand?: string | null;
};

export type ScheduleKind = "deposit" | "installment";

export type CreatePlanResponse = {
  planId: string;
  bookingId: string;
  bookingToken: string;
  frequency: PublicPlanFrequency;
  numPayments: number;
  totalAmountCents: number;
  originalTotalAmountCents: number | null;
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

// ---------------------------------------------------------------------------
// Customer plan portal (/plan/[token])
// ---------------------------------------------------------------------------

export type PublicPlanPortal = {
  merchant: {
    slug: string;
    businessName: string;
    businessType: string | null;
    brandColorPrimary: string | null;
    logoUrl: string | null;
    contactEmail: string;
  };
  booking: {
    serviceName: string;
    description: string | null;
    appointmentDate: string;
    checkoutDate: string | null;
    totalAmountCents: number;
    originalTotalAmountCents: number | null;
    customerNameHint: string | null;
    customerEmailHint: string | null;
  };
  plan: {
    id: string;
    frequency: PublicPlanFrequency;
    numPayments: number;
    totalAmountCents: number;
    depositAmountCents: number;
    status: string;
    startDate: string;
    endDate: string;
  };
  schedule: {
    sequence: number;
    dueDate: string;
    amountCents: number;
    status: string;
    kind: ScheduleKind;
    stripePaymentIntentId: string | null;
    paidAt: string | null;
  }[];
  card: {
    brand: string;
    lastFour: string;
    expMonth: number;
    expYear: number;
  } | null;
  processingFeeCents: number;
  paidCents: number;
  remainingCents: number;
  stripe: {
    configured: boolean;
    publishableKey: string | null;
  };
};

export async function fetchPlanPortal(token: string): Promise<PublicPlanPortal | null> {
  const res = await fetch(
    `${API_BASE_URL}/api/v1/public/plans/${encodeURIComponent(token)}`,
    { cache: "no-store" },
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`fetchPlanPortal failed: ${res.status}`);
  }
  return (await res.json()) as PublicPlanPortal;
}

export type PortalActionError = { error: string; message: string };

export async function payNextInstallment(
  token: string,
): Promise<{ ok: true; paymentIntentId: string; intentStatus: string } | { ok: false; error: PortalActionError; status: number }> {
  const res = await fetch(
    `${API_BASE_URL}/api/v1/public/plans/${encodeURIComponent(token)}/pay-next`,
    { method: "POST", headers: { "Content-Type": "application/json" } },
  );
  const body = await res.json().catch(() => ({} as Record<string, unknown>));
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      error: {
        error: (body as { error?: string }).error ?? "unknown_error",
        message: (body as { message?: string }).message ?? `Payment failed (${res.status})`,
      },
    };
  }
  return {
    ok: true,
    paymentIntentId: (body as { paymentIntentId?: string }).paymentIntentId ?? "",
    intentStatus: (body as { intentStatus?: string }).intentStatus ?? "",
  };
}

/**
 * Customer-initiated cancellation. State transition only on the backend (marks
 * the plan canceled and stops the remaining schedule rows). No Stripe refund is
 * posted; the refund figure shown to the guest is computed client-side from the
 * rate policy.
 */
export async function cancelPlan(
  token: string,
): Promise<{ ok: true } | { ok: false; error: PortalActionError; status: number }> {
  const res = await fetch(
    `${API_BASE_URL}/api/v1/public/plans/${encodeURIComponent(token)}/cancel`,
    { method: "POST", headers: { "Content-Type": "application/json" } },
  );
  const body = await res.json().catch(() => ({} as Record<string, unknown>));
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      error: {
        error: (body as { error?: string }).error ?? "unknown_error",
        message: (body as { message?: string }).message ?? `Cancel failed (${res.status})`,
      },
    };
  }
  return { ok: true };
}

export async function createPortalSetupIntent(
  token: string,
): Promise<{ ok: true; clientSecret: string } | { ok: false; error: PortalActionError; status: number }> {
  const res = await fetch(
    `${API_BASE_URL}/api/v1/public/plans/${encodeURIComponent(token)}/setup-intent`,
    { method: "POST", headers: { "Content-Type": "application/json" } },
  );
  const body = await res.json().catch(() => ({} as Record<string, unknown>));
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      error: {
        error: (body as { error?: string }).error ?? "unknown_error",
        message: (body as { message?: string }).message ?? `SetupIntent failed (${res.status})`,
      },
    };
  }
  return { ok: true, clientSecret: (body as { clientSecret?: string }).clientSecret ?? "" };
}

export type ReplacePaymentMethodRequest = {
  paymentMethodId: string;
  demoCardLastFour?: string | null;
  demoCardExpMonth?: number | null;
  demoCardExpYear?: number | null;
  demoCardBrand?: string | null;
};

// ---------------------------------------------------------------------------
// Customer account (/account)
// ---------------------------------------------------------------------------

export type AccountPlanCard = {
  planId: string;
  bookingToken: string;
  status: string;
  merchantSlug: string;
  merchantBusinessName: string;
  serviceName: string;
  appointmentDate: string;
  checkoutDate: string | null;
  totalAmountCents: number;
  originalTotalAmountCents: number | null;
  totalWithFeeCents: number;
  paidCents: number;
  remainingCents: number;
  numPayments: number;
  frequency: PublicPlanFrequency;
  paidCount: number;
  scheduledCount: number;
  nextDueDate: string | null;
  nextDueAmountCents: number | null;
};

export type AccountPlansResponse = {
  email: string;
  processingFeeCents: number;
  plans: AccountPlanCard[];
};

export type LoginRequest = { email: string; password: string };

export async function attemptCustomerLogin(
  payload: LoginRequest,
): Promise<{ ok: true; email: string } | { ok: false; error: PortalActionError; status: number }> {
  const res = await fetch(`${API_BASE_URL}/api/v1/public/account/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({} as Record<string, unknown>));
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      error: {
        error: (body as { error?: string }).error ?? "unknown_error",
        message: (body as { message?: string }).message ?? `Login failed (${res.status})`,
      },
    };
  }
  return { ok: true, email: (body as { email?: string }).email ?? payload.email };
}

export async function logoutCustomer(): Promise<void> {
  await fetch(`${API_BASE_URL}/api/v1/public/account/logout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
  });
}

/**
 * Server-side fetch (called from a Next server component). Forwards the
 * caller-provided cookie header so the backend can read
 * bliss_customer_session.
 */
export async function fetchAccountPlans(
  cookieHeader: string | null,
): Promise<AccountPlansResponse | null> {
  const headers: Record<string, string> = {};
  if (cookieHeader) headers["Cookie"] = cookieHeader;
  const res = await fetch(`${API_BASE_URL}/api/v1/public/account/plans`, {
    headers,
    cache: "no-store",
  });
  if (res.status === 401) return null;
  if (!res.ok) {
    throw new Error(`fetchAccountPlans failed: ${res.status}`);
  }
  return (await res.json()) as AccountPlansResponse;
}

export async function replacePaymentMethod(
  token: string,
  payload: ReplacePaymentMethodRequest,
): Promise<{ ok: true; card: { brand: string; lastFour: string; expMonth: number; expYear: number } } | { ok: false; error: PortalActionError; status: number }> {
  const res = await fetch(
    `${API_BASE_URL}/api/v1/public/plans/${encodeURIComponent(token)}/payment-method`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
  const body = await res.json().catch(() => ({} as Record<string, unknown>));
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      error: {
        error: (body as { error?: string }).error ?? "unknown_error",
        message: (body as { message?: string }).message ?? `Card replace failed (${res.status})`,
      },
    };
  }
  return {
    ok: true,
    card: (body as { card: { brand: string; lastFour: string; expMonth: number; expYear: number } }).card,
  };
}
