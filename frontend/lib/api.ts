// Client-side calls to the Bliss backend. All requests include the
// bliss_session cookie via `credentials: 'include'`. No token state lives in
// the browser outside the HttpOnly cookie.

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080";

export type Address = {
  line1: string | null;
  line2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string | null;
};

export type PmsType = "stripe" | "mews" | "cloudbeds";

export type OnboardingStateWire =
  | "created"
  | "pms_selected"
  | "pms_connected"
  | "policy_set"
  | "active";

export type MerchantView = {
  id: string;
  email: string;
  slug: string;
  businessName: string | null;
  businessType: string | null;
  phone: string | null;
  address: Address;
  stripeConnectStatus: string | null;
  status: string;
  onboardingComplete: boolean;
  onboardingState: OnboardingStateWire;
  pmsType: PmsType;
  emailVerifiedAt: string | null;
};

async function unwrap<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  return (await res.json()) as T;
}

export async function requestMagicLink(email: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/v1/auth/magic-link`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to send sign-in link: ${res.status} ${text}`);
  }
}

export async function verifyMagicLinkToken(token: string): Promise<MerchantView> {
  const res = await fetch(`${API_BASE_URL}/api/v1/auth/verify`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  return unwrap<MerchantView>(res);
}

export async function signOut(): Promise<void> {
  await fetch(`${API_BASE_URL}/api/v1/auth/sign-out`, {
    method: "POST",
    credentials: "include",
  });
}

export type DevAuthStatus = {
  devLoginEnabled: boolean;
};

export async function fetchDevAuthStatus(): Promise<DevAuthStatus> {
  const res = await fetch(`${API_BASE_URL}/api/v1/auth/dev-status`, {
    cache: "no-store",
  });
  if (!res.ok) return { devLoginEnabled: false };
  return (await res.json()) as DevAuthStatus;
}

export async function devLogin(email: string): Promise<MerchantView> {
  const res = await fetch(`${API_BASE_URL}/api/v1/auth/dev-login`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  return unwrap<MerchantView>(res);
}

export type UpdateMerchantPayload = {
  businessName: string;
  businessType: string;
  phone?: string;
  addressLine1?: string;
  addressLine2?: string;
  addressCity?: string;
  addressState?: string;
  addressZip?: string;
};

export async function updateMerchant(
  payload: UpdateMerchantPayload,
): Promise<MerchantView> {
  const res = await fetch(`${API_BASE_URL}/api/v1/merchants/me`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return unwrap<MerchantView>(res);
}

// --- Property onboarding (PMS selection + Mews connection) ---

export type OnboardingStep = { key: string; done: boolean };

export type OnboardingMews = {
  connected: boolean;
  enterpriseName: string | null;
  currency: string | null;
};

export type OnboardingCloudbeds = {
  connected: boolean;
  propertyName: string | null;
  currency: string | null;
};

export type OnboardingStatus = {
  onboardingState: OnboardingStateWire;
  pmsType: PmsType;
  complete: boolean;
  mews: OnboardingMews | null;
  cloudbeds: OnboardingCloudbeds | null;
  steps: OnboardingStep[];
};

/**
 * Full-page navigation target that starts Cloudbeds OAuth. The backend endpoint
 * 302s to the Cloudbeds authorize page; because it is an OAuth redirect it must
 * be a real navigation (window.location / an anchor), never a fetch.
 */
export function cloudbedsOAuthStartUrl(): string {
  return `${API_BASE_URL}/api/v1/cloudbeds/oauth/start`;
}

export async function fetchOnboardingStatus(): Promise<OnboardingStatus> {
  const res = await fetch(`${API_BASE_URL}/api/v1/merchants/me/onboarding`, {
    credentials: "include",
    cache: "no-store",
  });
  return unwrap<OnboardingStatus>(res);
}

export async function selectPms(pmsType: PmsType): Promise<OnboardingStatus> {
  const res = await fetch(`${API_BASE_URL}/api/v1/merchants/me/onboarding/pms`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pmsType }),
  });
  return unwrap<OnboardingStatus>(res);
}

export type MewsConnectPayload = {
  platformUrl?: string;
  clientToken: string;
  accessToken: string;
};

export type MewsConnectResult = { enterpriseName: string; currency: string };

/**
 * Validates and stores the property's Mews Connector tokens. On a failed
 * validation the backend returns 400 with `{error, message}`; we surface the
 * message so the form can show why it failed.
 */
export async function connectMews(
  payload: MewsConnectPayload,
): Promise<MewsConnectResult> {
  const res = await fetch(
    `${API_BASE_URL}/api/v1/merchants/me/onboarding/pms/mews/connect`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
  if (!res.ok) {
    let message = `Could not connect (${res.status}).`;
    try {
      const body = (await res.json()) as { message?: string; error?: string };
      message = body.message ?? body.error ?? message;
    } catch {
      /* keep default */
    }
    throw new Error(message);
  }
  return (await res.json()) as MewsConnectResult;
}

export async function activateOnboarding(): Promise<OnboardingStatus> {
  const res = await fetch(
    `${API_BASE_URL}/api/v1/merchants/me/onboarding/activate`,
    { method: "POST", credentials: "include" },
  );
  return unwrap<OnboardingStatus>(res);
}

/** Clears the stored Mews connection and reverts onboarding to pms_selected. */
export async function disconnectMews(): Promise<OnboardingStatus> {
  const res = await fetch(
    `${API_BASE_URL}/api/v1/merchants/me/onboarding/pms/mews/disconnect`,
    { method: "POST", credentials: "include" },
  );
  return unwrap<OnboardingStatus>(res);
}

export type StripeStatus = {
  status: "not_started" | "in_progress" | "charges_enabled" | "restricted";
  accountId: string | null;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  disabledReason: string | null;
  configured: boolean;
};

export type StripeAccountLink = {
  url: string;
  expiresAt: number | null;
};

export type StripeNotConfiguredError = {
  error: "stripe_not_configured";
  message: string;
};

export async function fetchStripeStatus(): Promise<StripeStatus> {
  const res = await fetch(`${API_BASE_URL}/api/v1/merchants/me/stripe-status`, {
    credentials: "include",
    cache: "no-store",
  });
  return unwrap<StripeStatus>(res);
}

export async function createStripeAccountLink(): Promise<
  StripeAccountLink | StripeNotConfiguredError
> {
  const res = await fetch(`${API_BASE_URL}/api/v1/stripe/connect/account-link`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
  });
  if (res.status === 503) {
    return (await res.json()) as StripeNotConfiguredError;
  }
  return unwrap<StripeAccountLink>(res);
}

export type DemoStripeConnectResult = {
  status: "charges_enabled";
  accountId: string;
  configured: boolean;
  demo: boolean;
};

/**
 * Demo-only: marks the current merchant Stripe-connected without a real
 * Connect account. Backend refuses (409) if real Stripe is configured.
 */
export async function completeStripeConnectDemo(): Promise<DemoStripeConnectResult> {
  const res = await fetch(
    `${API_BASE_URL}/api/v1/stripe/connect/demo-complete`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    },
  );
  return unwrap<DemoStripeConnectResult>(res);
}

/**
 * Per-property Stripe Connect *Standard* status, read from
 * merchant_stripe_connections. Distinct from StripeStatus, which reports the
 * older Express account stored on the merchant row.
 */
export type StripeConnectStatus = {
  configured: boolean;
  connected: boolean;
  status: "not_started" | "in_progress" | "charges_enabled" | "restricted";
  accountId: string | null;
  chargesEnabled: boolean;
};

export async function fetchStripeConnectStatus(): Promise<StripeConnectStatus> {
  const res = await fetch(
    `${API_BASE_URL}/api/v1/merchants/stripe-connect/status`,
    { credentials: "include", cache: "no-store" },
  );
  return unwrap<StripeConnectStatus>(res);
}

/**
 * Starts or resumes Standard onboarding. Returns a one-time Stripe-hosted URL
 * to send the browser to, or the not-configured error when the backend has no
 * Stripe key (demo mode).
 */
export async function startStripeConnect(): Promise<
  StripeAccountLink | StripeNotConfiguredError
> {
  const res = await fetch(
    `${API_BASE_URL}/api/v1/merchants/stripe-connect/start`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    },
  );
  if (res.status === 503) {
    return (await res.json()) as StripeNotConfiguredError;
  }
  return unwrap<StripeAccountLink>(res);
}

/**
 * Demo-only Standard completion, for when Stripe is not configured and there is
 * no hosted flow to run. Backend refuses (409) if real Stripe is configured.
 */
export async function completeStripeConnectStandardDemo(): Promise<StripeConnectStatus> {
  const res = await fetch(
    `${API_BASE_URL}/api/v1/merchants/stripe-connect/demo-complete`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    },
  );
  return unwrap<StripeConnectStatus>(res);
}

export type MewsConnection = {
  connected: boolean;
  enterpriseName?: string;
  city?: string;
  countryCode?: string;
};

/** Read-only probe confirming the .env Mews credentials resolve to a live property. */
export async function fetchMewsConnection(): Promise<MewsConnection> {
  const res = await fetch(
    `${API_BASE_URL}/api/v1/mews/marketplace/connection`,
    { cache: "no-store" },
  );
  return unwrap<MewsConnection>(res);
}

export type BookingStatus =
  | "draft"
  | "sent"
  | "accepted"
  | "in_progress"
  | "completed"
  | "canceled";

export type PlanFrequency = "biweekly" | "monthly";

export type PlanOption = {
  frequency: PlanFrequency;
  numPayments: number;
  perPaymentAmountCents: number;
  finalPaymentAmountCents: number;
  dueDates: string[]; // ISO yyyy-MM-dd
};

export type Eligibility = {
  eligible: boolean;
  reason: string;
  daysToAppointment: number;
  depositAmountCents: number;
};

export type BookingSource =
  | "merchant_initiated"
  | "customer_initiated"
  | "mews_import";

export type Booking = {
  id: string;
  bookingToken: string;
  hostedUrl: string;
  serviceName: string;
  serviceDescription: string | null;
  totalAmountCents: number;
  originalTotalAmountCents: number | null;
  appointmentDate: string;
  checkoutDate: string | null;
  cancellationPolicy: string | null;
  status: BookingStatus;
  source: BookingSource;
  customerNameHint: string | null;
  customerEmailHint: string | null;
  customerPhoneHint: string | null;
  createdAt: string;
  // Derived table status from the merchant bookings list endpoint (real
  // plan/schedule data, as-of today). Null on the booking-detail endpoint.
  derivedStatus: DerivedBookingStatus | null;
  eligibility: Eligibility | null;
  planOptions: PlanOption[] | null;
};

export type DerivedBookingStatus =
  | "cancelled"
  | "booking_complete"
  | "payments_complete"
  | "late"
  | "active"
  | "other";

export type CreateBookingPayload = {
  serviceName: string;
  serviceDescription?: string;
  totalAmountCents: number;
  appointmentDate: string;
  cancellationPolicy?: string;
  customerNameHint?: string;
  customerEmailHint?: string;
};

export type BookingListResponse = {
  bookings: Booking[];
  total: number;
  limit: number;
  offset: number;
};

export async function createBooking(
  payload: CreateBookingPayload,
): Promise<Booking> {
  const res = await fetch(`${API_BASE_URL}/api/v1/bookings`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return unwrap<Booking>(res);
}

export async function listBookings(): Promise<BookingListResponse> {
  const res = await fetch(`${API_BASE_URL}/api/v1/bookings`, {
    credentials: "include",
    cache: "no-store",
  });
  return unwrap<BookingListResponse>(res);
}

export async function getBooking(id: string): Promise<Booking> {
  const res = await fetch(`${API_BASE_URL}/api/v1/bookings/${id}`, {
    credentials: "include",
    cache: "no-store",
  });
  return unwrap<Booking>(res);
}

export type AllowedFrequencies = "monthly" | "biweekly" | "both";
export type DepositType = "percentage" | "fixed";
export type FeeType = "fixed" | "percentage";
export type LateFeeScope = "per_failure" | "once_per_plan";

export type RefundPolicy =
  | "full"
  | "none"
  | "first_installment_only"
  | "sliding_scale"
  | "credit_only";

export type PaymentDuePolicy =
  | "at_appointment"
  | "one_week_before"
  | "one_month_before"
  | "custom_months";

export type AfterRetriesAction =
  | "treat_as_cancellation"
  | "balance_due_at_checkin";

export type PlanRules = {
  minLeadTimeWeeks: number;
  maxLeadTimeWeeks: number | null;
  allowedFrequencies: AllowedFrequencies;
  minBookingAmountCents: number | null;
  maxBookingAmountCents: number | null;
  recommendedFrequency: PlanFrequency | null;
  depositRequired: boolean;
  depositType: DepositType | null;
  depositValue: number | null;
  depositMaxCents: number | null;
  refundPolicy: RefundPolicy;
  refundSlidingThresholdPercent: number | null;
  cancellationFeeEnabled: boolean;
  cancellationFeeType: FeeType | null;
  cancellationFeeValue: number | null;
  cancellationFeeThresholdPercent: number | null;
  paymentDuePolicy: PaymentDuePolicy;
  paymentDueCustomMonths: number | null;
  retryAttempts: number;
  retrySpacingDays: number;
  lateFeeEnabled: boolean;
  lateFeeType: FeeType | null;
  lateFeeValue: number | null;
  lateFeeScope: LateFeeScope | null;
  afterRetriesAction: AfterRetriesAction;
  discountBasisPoints: number;
};

export const DEFAULT_PLAN_RULES: PlanRules = {
  minLeadTimeWeeks: 6,
  maxLeadTimeWeeks: null,
  allowedFrequencies: "both",
  minBookingAmountCents: null,
  maxBookingAmountCents: null,
  recommendedFrequency: null,
  depositRequired: false,
  depositType: null,
  depositValue: null,
  depositMaxCents: null,
  refundPolicy: "full",
  refundSlidingThresholdPercent: null,
  cancellationFeeEnabled: false,
  cancellationFeeType: null,
  cancellationFeeValue: null,
  cancellationFeeThresholdPercent: null,
  paymentDuePolicy: "at_appointment",
  paymentDueCustomMonths: null,
  retryAttempts: 3,
  retrySpacingDays: 3,
  lateFeeEnabled: false,
  lateFeeType: null,
  lateFeeValue: null,
  lateFeeScope: null,
  afterRetriesAction: "treat_as_cancellation",
  discountBasisPoints: 0,
};

export async function fetchPlanRules(): Promise<PlanRules> {
  const res = await fetch(`${API_BASE_URL}/api/v1/merchants/me/plan-rules`, {
    credentials: "include",
    cache: "no-store",
  });
  return unwrap<PlanRules>(res);
}

export async function updatePlanRules(payload: PlanRules): Promise<PlanRules> {
  const res = await fetch(`${API_BASE_URL}/api/v1/merchants/me/plan-rules`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return unwrap<PlanRules>(res);
}

export type PaymentPlanStatus =
  | "pending_card"
  | "active"
  | "payment_failed_in_retry"
  | "payment_failed_exhausted"
  | "balance_due"
  | "refund_due"
  | "completed"
  | "defaulted"
  | "canceled";

export type PlanScheduleEntry = {
  sequence: number;
  kind: "deposit" | "installment";
  dueDate: string;
  amountCents: number;
  status: string;
  retryCount: number;
};

export type FailedInstallment = {
  sequence: number;
  dueDate: string;
  amountCents: number;
  retryCount: number;
  lastError: string | null;
};

export type PlanDetail = {
  id: string;
  bookingId: string;
  serviceName: string;
  appointmentDate: string;
  totalAmountCents: number;
  depositAmountCents: number;
  frequency: PlanFrequency;
  numPayments: number;
  status: PaymentPlanStatus;
  customerHint: string | null;
  schedule: PlanScheduleEntry[];
  failedInstallment: FailedInstallment | null;
};

export type AttentionResponse = { plans: PlanDetail[]; count: number };

export async function fetchAttentionPlans(): Promise<AttentionResponse> {
  const res = await fetch(`${API_BASE_URL}/api/v1/plans/attention`, {
    credentials: "include",
    cache: "no-store",
  });
  return unwrap<AttentionResponse>(res);
}

// --- Booking modification / plan recalculation ---

export type ModificationScheduleRow = {
  sequence: number;
  dueDate: string;
  amountCents: number;
  status: string;
  kind: string;
};

export type ModificationResult = {
  outcome: "REBUILT" | "REFUND_DUE";
  preview: boolean;
  appointmentDate: string;
  checkoutDate: string | null;
  totalAmountCents: number;
  planStatus: string;
  planTotalAmountCents: number;
  numPayments: number;
  collectedCents: number;
  remainingToCollectCents: number;
  overpaidCents: number;
  schedule: ModificationScheduleRow[];
  message: string;
};

export type ModifyBookingPayload = {
  appointmentDate?: string;
  checkoutDate?: string;
  newTotalAmountCents?: number;
  preview: boolean;
};

/**
 * Modify a booking's dates/total and recalculate the plan. With `preview: true`
 * the backend computes the rebuilt schedule without persisting. Errors (invalid
 * input, impossible deadline) come back with a message the form can surface.
 */
export async function modifyBooking(
  bookingId: string,
  payload: ModifyBookingPayload,
): Promise<
  | { ok: true; data: ModificationResult }
  | { ok: false; status: number; message: string }
> {
  const res = await fetch(`${API_BASE_URL}/api/v1/bookings/${bookingId}/modify`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (res.ok) {
    return { ok: true, data: (await res.json()) as ModificationResult };
  }
  let message = `Could not modify booking (${res.status}).`;
  try {
    const body = (await res.json()) as { message?: string; error?: string };
    message = body.message ?? body.error ?? message;
  } catch {
    /* keep default */
  }
  return { ok: false, status: res.status, message };
}

export async function fetchPlan(id: string): Promise<PlanDetail> {
  const res = await fetch(`${API_BASE_URL}/api/v1/plans/${id}`, {
    credentials: "include",
    cache: "no-store",
  });
  return unwrap<PlanDetail>(res);
}

async function planAction(id: string, action: string, body?: unknown): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/v1/plans/${id}/${action}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: body == null ? "{}" : JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Plan ${action} failed: ${res.status} ${text}`);
  }
}

export async function retryPlan(id: string): Promise<void> {
  return planAction(id, "retry");
}

export async function cancelPlan(id: string): Promise<void> {
  return planAction(id, "cancel");
}

// Manager refund override. Independent of cancel, not policy-gated; simulated
// (no real money movement) and recorded as state on the shared plan record.
export async function refundPlan(id: string): Promise<void> {
  return planAction(id, "refund");
}

export async function resolvePlan(id: string): Promise<void> {
  return planAction(id, "resolve");
}

export async function overridePlanState(id: string, status: PaymentPlanStatus): Promise<void> {
  return planAction(id, "override-state", { status });
}

export async function devMarkPlanFailed(
  id: string,
  mode: "fail" | "exhaust" = "fail",
): Promise<{ planStatus: PaymentPlanStatus; afterRetriesAction: string }> {
  const res = await fetch(`${API_BASE_URL}/api/v1/dev/plans/${id}/mark-failed`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Dev mark-failed: ${res.status} ${text}`);
  }
  return (await res.json()) as { planStatus: PaymentPlanStatus; afterRetriesAction: string };
}
