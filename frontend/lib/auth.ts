// Server-side helpers for reading the bliss_session cookie and calling the
// backend on behalf of the current request. Used by server components.

import { cookies } from "next/headers";
import {
  API_BASE_URL,
  type Booking,
  type BookingListResponse,
  type MerchantView,
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
