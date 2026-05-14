"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { verifyMagicLinkToken } from "@/lib/api";

type Status = "verifying" | "success" | "error";

export function VerifyClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [status, setStatus] = useState<Status>("verifying");
  const [error, setError] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    if (!token) {
      setStatus("error");
      setError("Missing sign-in token");
      return;
    }
    verifyMagicLinkToken(token)
      .then((merchant) => {
        setStatus("success");
        router.push(merchant.onboardingComplete ? "/dashboard" : "/onboarding");
      })
      .catch((err: unknown) => {
        setStatus("error");
        setError(
          err instanceof Error ? err.message : "Sign in failed. Request a new link.",
        );
      });
  }, [router, token]);

  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-sm text-center">
        <div className="text-xl font-medium tracking-tight">bliss</div>
        {status === "verifying" && (
          <p className="mt-6 text-ink-muted">Signing you in</p>
        )}
        {status === "success" && (
          <p className="mt-6 text-ink-muted">Signed in. Redirecting</p>
        )}
        {status === "error" && (
          <div className="mt-6">
            <p className="text-red-600">{error}</p>
            <a href="/login" className="mt-4 inline-block btn-primary">
              Request a new link
            </a>
          </div>
        )}
      </div>
    </main>
  );
}
