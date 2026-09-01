"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { verifyCustomerMagicLink } from "@/lib/publicApi";
import { AuthError, AuthShell } from "@/components/auth/AuthShell";

// Guest counterpart to /verify. Consumes the token, which sets the customer
// session cookie, then lands on the portal.
type Status = "verifying" | "success" | "error";

export function VerifyGuestClient() {
  const router = useRouter();
  const token = useSearchParams().get("token");
  const [status, setStatus] = useState<Status>("verifying");
  const [error, setError] = useState<string | null>(null);
  // The token is single use, so a StrictMode double-invoke would consume it
  // once and then report the second call as invalid.
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    if (!token) {
      setStatus("error");
      setError("Missing sign-in token.");
      return;
    }
    verifyCustomerMagicLink(token).then((result) => {
      if (!result.ok) {
        setStatus("error");
        setError(result.error.message);
        return;
      }
      setStatus("success");
      router.push("/account");
      router.refresh();
    });
  }, [router, token]);

  return (
    <AuthShell
      heading={status === "error" ? "That link expired" : "Signing you in"}
      subhead={
        status === "error"
          ? undefined
          : "One moment while we open your account."
      }
      footer={
        status === "error" ? (
          <a href="/account/login" className="font-medium text-brand-violet">
            Request a new link
          </a>
        ) : undefined
      }
    >
      {status === "error" && error ? <AuthError>{error}</AuthError> : null}
    </AuthShell>
  );
}
