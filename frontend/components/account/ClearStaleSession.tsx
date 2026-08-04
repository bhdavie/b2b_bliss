"use client";

import { useEffect, useRef } from "react";
import { logoutCustomer } from "@/lib/publicApi";

/**
 * Clears a bliss_customer_session cookie that is present but no longer
 * verifies, so a dead session does not sit in the browser for whatever remains
 * of its Max-Age. Cookie and token now expire together, so this is the narrow
 * case: clock skew, a rotated signing secret, or a role mismatch.
 *
 * Why this goes through the backend rather than deleting the cookie directly:
 * the cookie is HttpOnly, so script cannot touch it, and a Next server
 * component cannot modify cookies during render. The backend builds its clear
 * from the same CookieOptions as the set, so Domain, Path and SameSite match
 * and the browser actually drops it. A clear whose scope differs from the set
 * is silently a no-op (see SessionCookies.build).
 *
 * Renders nothing. A failure is deliberately ignored: the sign-in form is
 * already usable without it, and a successful sign-in overwrites the cookie.
 */
export function ClearStaleSession() {
  const cleared = useRef(false);

  useEffect(() => {
    // Effects run twice under StrictMode in dev; one clear is enough.
    if (cleared.current) return;
    cleared.current = true;
    logoutCustomer().catch(() => {});
  }, []);

  return null;
}
