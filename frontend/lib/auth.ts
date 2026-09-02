// Server-side helpers for reading the bliss_session cookie and calling the
// backend on behalf of the current request. Used by server components.

import { cookies } from "next/headers";
import {
  API_BASE_URL,
  type AdminMerchantDetail,
  type AdminMerchantRow,
  type AdminView,
  type AttentionResponse,
  type Booking,
  type BookingListResponse,
  type MerchantView,
  type OnboardingStatus,
  type PlanDetail,
  type PlanRules,
  type StripeStatus,
} from "./api";

export const SESSION_COOKIE = "bliss_session";

async function sessionHeader(): Promise<{ Cookie: string } | null> {
  const cookieStore = await cookies();
  const session = cookieStore.get(SESSION_COOKIE);
  if (!session?.value) return null;
  return { Cookie: `${SESSION_COOKIE}=${session.value}` };
}

// ---------------------------------------------------------------------------
// Bliss internal admin. A parallel pair to the merchant helpers above, reading
// a different cookie and hitting a different endpoint. Deliberately separate
// functions rather than a cookie-name parameter on the existing ones: the two
// sessions must not be reachable through one call site that could be handed
// the wrong name.
// ---------------------------------------------------------------------------

export const ADMIN_SESSION_COOKIE = "bliss_admin_session";

async function adminSessionHeader(): Promise<{ Cookie: string } | null> {
  const cookieStore = await cookies();
  const session = cookieStore.get(ADMIN_SESSION_COOKIE);
  if (!session?.value) return null;
  return { Cookie: `${ADMIN_SESSION_COOKIE}=${session.value}` };
}

/**
 * The signed-in admin, or null when there is no admin session. Null on 401 and
 * on a missing cookie alike, so the layout has one thing to test. A merchant
 * cookie does not help: it is a different cookie name, and the backend's admin
 * authenticator additionally requires role=admin and a live admin_users row.
 */
export async function fetchAdminSession(): Promise<AdminView | null> {
  const headers = await adminSessionHeader();
  if (!headers) return null;
  const res = await fetch(`${API_BASE_URL}/api/v1/admin/auth/me`, {
    headers,
    cache: "no-store",
  });
  if (res.status === 401) return null;
  if (!res.ok) {
    throw new Error(`fetchAdminSession failed: ${res.status}`);
  }
  return (await res.json()) as AdminView;
}

/**
 * Every property, newest joined first. Returns null on 401 so the caller can
 * treat an expired admin session the same way the layout does.
 */
export async function fetchAdminMerchants(): Promise<AdminMerchantRow[] | null> {
  const headers = await adminSessionHeader();
  if (!headers) return null;
  const res = await fetch(`${API_BASE_URL}/api/v1/admin/merchants`, {
    headers,
    cache: "no-store",
  });
  if (res.status === 401) return null;
  if (!res.ok) {
    throw new Error(`fetchAdminMerchants failed: ${res.status}`);
  }
  return (await res.json()) as AdminMerchantRow[];
}

/**
 * One property in full. Returns null for BOTH 401 and 404: the caller renders
 * notFound() either way, since an admin who cannot see a property and a
 * property that does not exist are the same dead end from the page's side.
 */
export async function fetchAdminMerchantDetail(
  id: string,
): Promise<AdminMerchantDetail | null> {
  const headers = await adminSessionHeader();
  if (!headers) return null;
  const res = await fetch(`${API_BASE_URL}/api/v1/admin/merchants/${id}`, {
    headers,
    cache: "no-store",
  });
  if (res.status === 401 || res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`fetchAdminMerchantDetail failed: ${res.status}`);
  }
  return (await res.json()) as AdminMerchantDetail;
}

export async function fetchMerchantSession(): Promise<MerchantView | null> {
  const headers = await sessionHeader();
  if (!headers) return null;
  const res = await fetch(`${API_BASE_URL}/api/v1/merchants/me`, {
    headers,
    cache: "no-store",
  });
  if (res.status === 401) return null;
  if (!res.ok) {
    throw new Error(`fetchMerchantSession failed: ${res.status}`);
  }
  return (await res.json()) as MerchantView;
}

export async function fetchOnboardingServer(): Promise<OnboardingStatus | null> {
  const headers = await sessionHeader();
  if (!headers) return null;
  const res = await fetch(`${API_BASE_URL}/api/v1/merchants/me/onboarding`, {
    headers,
    cache: "no-store",
  });
  if (res.status === 401) return null;
  if (!res.ok) {
    throw new Error(`fetchOnboardingServer failed: ${res.status}`);
  }
  return (await res.json()) as OnboardingStatus;
}

export async function fetchStripeStatusServer(): Promise<StripeStatus | null> {
  const headers = await sessionHeader();
  if (!headers) return null;
  const res = await fetch(`${API_BASE_URL}/api/v1/merchants/me/stripe-status`, {
    headers,
    cache: "no-store",
  });
  if (res.status === 401) return null;
  if (!res.ok) {
    throw new Error(`fetchStripeStatusServer failed: ${res.status}`);
  }
  return (await res.json()) as StripeStatus;
}

export async function fetchBookingsServer(): Promise<BookingListResponse | null> {
  const headers = await sessionHeader();
  if (!headers) return null;
  const res = await fetch(`${API_BASE_URL}/api/v1/bookings`, {
    headers,
    cache: "no-store",
  });
  if (res.status === 401) return null;
  if (!res.ok) {
    throw new Error(`fetchBookingsServer failed: ${res.status}`);
  }
  return (await res.json()) as BookingListResponse;
}

export async function fetchPlanRulesServer(): Promise<PlanRules | null> {
  const headers = await sessionHeader();
  if (!headers) return null;
  const res = await fetch(`${API_BASE_URL}/api/v1/merchants/me/plan-rules`, {
    headers,
    cache: "no-store",
  });
  if (res.status === 401) return null;
  if (!res.ok) {
    throw new Error(`fetchPlanRulesServer failed: ${res.status}`);
  }
  return (await res.json()) as PlanRules;
}

export async function fetchAttentionPlansServer(): Promise<AttentionResponse | null> {
  const headers = await sessionHeader();
  if (!headers) return null;
  const res = await fetch(`${API_BASE_URL}/api/v1/plans/attention`, {
    headers,
    cache: "no-store",
  });
  if (res.status === 401) return null;
  if (!res.ok) {
    throw new Error(`fetchAttentionPlansServer failed: ${res.status}`);
  }
  return (await res.json()) as AttentionResponse;
}

export async function fetchPlanServer(id: string): Promise<PlanDetail | null> {
  const headers = await sessionHeader();
  if (!headers) return null;
  const res = await fetch(`${API_BASE_URL}/api/v1/plans/${id}`, {
    headers,
    cache: "no-store",
  });
  if (res.status === 401 || res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`fetchPlanServer failed: ${res.status}`);
  }
  return (await res.json()) as PlanDetail;
}

export async function fetchBookingServer(id: string): Promise<Booking | null> {
  const headers = await sessionHeader();
  if (!headers) return null;
  const res = await fetch(`${API_BASE_URL}/api/v1/bookings/${id}`, {
    headers,
    cache: "no-store",
  });
  if (res.status === 401 || res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`fetchBookingServer failed: ${res.status}`);
  }
  return (await res.json()) as Booking;
}
