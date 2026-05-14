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
