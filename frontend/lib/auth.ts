// Server-side helpers for reading the bliss_session cookie and calling the
// backend on behalf of the current request. Used by server components.

import { cookies } from "next/headers";
import { API_BASE_URL, type MerchantView } from "./api";

export const SESSION_COOKIE = "bliss_session";

export async function fetchMerchantSession(): Promise<MerchantView | null> {
  const cookieStore = await cookies();
  const session = cookieStore.get(SESSION_COOKIE);
  if (!session?.value) {
    return null;
  }
  const res = await fetch(`${API_BASE_URL}/api/v1/merchants/me`, {
    headers: { Cookie: `${SESSION_COOKIE}=${session.value}` },
    cache: "no-store",
  });
  if (res.status === 401) return null;
  if (!res.ok) {
    throw new Error(`fetchMerchantSession failed: ${res.status}`);
  }
  return (await res.json()) as MerchantView;
}
