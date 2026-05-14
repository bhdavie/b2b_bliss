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
};

export type Booking = {
  id: string;
  bookingToken: string;
  hostedUrl: string;
  serviceName: string;
  serviceDescription: string | null;
  totalAmountCents: number;
  appointmentDate: string;
  cancellationPolicy: string | null;
  status: BookingStatus;
  customerNameHint: string | null;
  customerEmailHint: string | null;
  createdAt: string;
  eligibility: Eligibility | null;
  planOptions: PlanOption[] | null;
};

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
