// Server-side helpers for reading the bliss_session cookie and calling the
// backend on behalf of the current request. Used by server components.

import { cookies } from "next/headers";
import { API_BASE_URL, type MerchantView, type StripeStatus } from "./api";

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
