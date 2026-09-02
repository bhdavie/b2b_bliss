"use client";

import { BlissWordmark } from "@/components/BlissWordmark";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { verifyAdminMagicLinkToken } from "@/lib/api";

type Status = "verifying" | "success" | "error";

export function AdminVerifyClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [status, setStatus] = useState<Status>("verifying");
  const [error, setError] = useState<string | null>(null);
  // Admin tokens are single-use: the backend consumes the row on the first
  // successful verify. React 18 mounts effects twice in dev, so without this
  // guard the second call would consume-then-fail against a spent token and
  // show an error on a sign-in that actually worked.
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    if (!token) {
      setStatus("error");
      setError("Missing sign-in token");
      return;
    }
    verifyAdminMagicLinkToken(token)
      .then(() => {
        setStatus("success");
        router.push("/admin");
      })
      .catch((err: unknown) => {
        setStatus("error");
        setError(
          err instanceof Error ? err.message : "Sign in failed. Request a new link.",
        );
      });
  }, [router, token]);

  return (
    <main className="flex min-h-screen items-center justify-center px-6 font-inter">
      <div className="w-full max-w-sm text-center">
        <BlissWordmark className="text-xl tracking-tight text-brand-violet" />
        {status === "verifying" && <p className="mt-6 text-ink-500">Signing you in</p>}
        {status === "success" && (
          <p className="mt-6 text-ink-500">Signed in. Redirecting</p>
        )}
        {status === "error" && (
          <div className="mt-6">
            <p className="text-red-600">{error}</p>
            <a href="/admin/login" className="btn-primary mt-4 inline-block">
              Request a new link
            </a>
          </div>
        )}
      </div>
    </main>
  );
}
