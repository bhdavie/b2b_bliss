"use client";

import { BlissWordmark } from "@/components/BlissWordmark";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { devLogin, fetchDevAuthStatus, requestMagicLink } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

// Chrome is signup's, so the two auth screens read as one product: no card, the
// form straight on the page in a centred max-w-sm column, the same header stack
// (wordmark, 18px title, muted line), `.label` + `.input` fields, and the shared
// violet pill for the primary action. Single column by design — the two-panel
// split and the plan preview are signup's alone.
//
// Which sign-in the backend is currently offering. Read at runtime from
// /api/v1/auth/dev-status rather than baked in at build time, so flipping
// BLISS_DEMO_LOGIN switches this page over with no code change and no
// redeploy. null = still asking.
type Mode = "demo" | "magic-link" | null;

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
        await devLogin(email);
        // Always land on the dashboard; incomplete properties see the setup
        // checklist there until they go live.
        router.push("/home");
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
    <main className="flex min-h-screen items-center justify-center px-6 py-16 font-body">
      <form onSubmit={handleSubmit} className="w-full max-w-sm flex flex-col gap-4">
        <header>
          <BlissWordmark className="text-xl tracking-tight text-brand-violet" />
          <h1 className="mt-4 text-lg font-medium">Sign in</h1>
          <p className="mt-1 text-ink-muted">
            {mode === "magic-link"
              ? "We will email you a link to sign in."
              : "Sign in to your Marbrook House dashboard."}
          </p>
        </header>

        <label className="flex flex-col gap-1.5">
          <span className="label">Email</span>
          <Input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
        </label>

        {mode === "demo" ? (
          <label className="flex flex-col gap-1.5">
            <span className="label">Password</span>
            <Input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </label>
        ) : null}

        {error ? (
          <div className="text-xs text-red-600" role="alert">
            {error}
          </div>
        ) : null}

        <Button
          type="submit"
          disabled={submitting || mode === null}
          variant="primary"
        >
          {buttonLabel(mode, submitting)}
        </Button>

        <p className="text-xs text-ink-muted text-center">
          New here?{" "}
          <Link href="/signup" className="font-medium text-brand-violet">
            Create an account
          </Link>
        </p>
      </form>
    </main>
  );
}

function buttonLabel(mode: Mode, submitting: boolean): string {
  if (mode === "magic-link") return submitting ? "Sending link" : "Email me a link";
  return submitting ? "Signing in" : "Sign in";
}
