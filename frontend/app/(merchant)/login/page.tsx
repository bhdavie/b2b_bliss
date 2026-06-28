"use client";

import { BlissWordmark } from "@/components/BlissWordmark";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { devLogin, fetchDevAuthStatus, requestMagicLink } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devMode, setDevMode] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchDevAuthStatus()
      .then((status) => {
        if (!cancelled) setDevMode(status.devLoginEnabled);
      })
      .catch(() => {
        if (!cancelled) setDevMode(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (devMode) {
        const merchant = await devLogin(email);
        router.push(merchant.onboardingComplete ? "/dashboard" : "/onboarding");
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

  // Wait for the dev-mode probe to settle before rendering the CTA so we
  // never flash "We will email you a link" to a developer who clicks
  // through instantly in demo mode.
  const ready = devMode !== null;
  const cta = !ready
    ? "Continue"
    : devMode
      ? submitting
        ? "Signing in"
        : "Sign in"
      : submitting
        ? "Sending"
        : "Continue";

  return (
    <main className="min-h-screen flex items-center justify-center px-6 font-body">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm flex flex-col gap-4"
      >
        <header>
          <BlissWordmark className="text-xl tracking-tight text-brand-navy" />
          <h1 className="mt-4 text-lg font-medium">Sign in</h1>
          <p className="mt-1 text-ink-muted">
            {!ready
              ? " "
              : devMode
                ? "Enter any email to sign in instantly."
                : "We will email you a link to sign in."}
          </p>
        </header>

        <label className="flex flex-col gap-1.5">
          <span className="label">Email</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="input"
            autoComplete="email"
          />
        </label>

        {error ? (
          <div className="text-xs text-red-600" role="alert">
            {error}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={!ready || submitting}
          className="btn-primary"
        >
          {cta}
        </button>

        {devMode ? (
          <p className="text-[10px] uppercase tracking-wide text-amber-700 bg-amber-100 px-2 py-1 rounded text-center">
            Dev mode · magic-link bypass active
          </p>
        ) : null}

        <p className="text-xs text-ink-muted text-center">
          New here?{" "}
          <Link href="/signup" className="text-brand-purple">
            Create an account
          </Link>
        </p>
      </form>
    </main>
  );
}
