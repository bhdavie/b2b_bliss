"use client";

import { BlissWordmark } from "@/components/BlissWordmark";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { devLogin, fetchDevAuthStatus, requestMagicLink } from "@/lib/api";

// Which sign-in the backend is currently offering. Read at runtime from
// /api/v1/auth/dev-status rather than baked in at build time, so flipping
// BLISS_DEMO_LOGIN switches this page over with no code change and no
// redeploy. null = still asking.
type Mode = "demo" | "magic-link" | null;

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(null);
  // Demo defaults: both fields are pre-filled so signing in needs no typing.
  const [email, setEmail] = useState("demo@marbrookhouse.com");
  const [password, setPassword] = useState("1234");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // fetchDevAuthStatus reports disabled if the probe itself fails, so an
    // unreachable backend lands on the magic-link path rather than offering a
    // sign-in that would 404.
    fetchDevAuthStatus()
      .then((status) => setMode(status.devLoginEnabled ? "demo" : "magic-link"))
      .catch(() => setMode("magic-link"));
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (mode === "demo") {
        // Demo sign-in: the password is decorative and not validated.
        // devLogin establishes the merchant session so the dashboard loads.
        const merchant = await devLogin(email);
        router.push(merchant.onboardingComplete ? "/home" : "/onboarding");
        router.refresh();
        return;
      }
      await requestMagicLink(email);
      router.push(`/check-email?email=${encodeURIComponent(email)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-brand-cream/40 px-6 font-body">
      <div className="w-full max-w-sm">
        <div className="text-center">
          <BlissWordmark className="text-3xl tracking-tight text-brand-purple" />
        </div>

        <div className="mt-6 rounded-none border border-brand-neutral bg-white p-8 shadow-sm">
          <h1 className="text-2xl font-bold text-brand-navy">Sign in</h1>
          <p className="mt-1 text-sm text-ink-muted">
            {mode === "magic-link"
              ? "We will email you a link to sign in."
              : "Sign in to your Marbrook House dashboard."}
          </p>

          <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="label">Email</span>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                className="w-full rounded-none border border-brand-neutral bg-white px-3 py-2.5 text-sm text-ink focus:border-brand-purple focus:outline-none focus:ring-2 focus:ring-brand-lavender/60"
              />
            </label>

            {mode === "demo" ? (
              <label className="flex flex-col gap-1.5">
                <span className="label">Password</span>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  className="w-full rounded-none border border-brand-neutral bg-white px-3 py-2.5 text-sm text-ink focus:border-brand-purple focus:outline-none focus:ring-2 focus:ring-brand-lavender/60"
                />
              </label>
            ) : null}

            {error ? (
              <div className="text-xs text-red-600" role="alert">
                {error}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={submitting || mode === null}
              className="mt-1 inline-flex items-center justify-center rounded-md bg-brand-purple px-4 py-2.5 font-medium text-white transition-colors hover:bg-brand-purple-dark disabled:cursor-not-allowed disabled:opacity-60"
            >
              {buttonLabel(mode, submitting)}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-ink-muted">
          New here?{" "}
          <Link href="/signup" className="font-medium text-brand-purple">
            Create an account
          </Link>
        </p>
      </div>
    </main>
  );
}

function buttonLabel(mode: Mode, submitting: boolean): string {
  if (mode === "magic-link") return submitting ? "Sending link" : "Email me a link";
  return submitting ? "Signing in" : "Sign in";
}
