"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { devLogin, fetchDevAuthStatus, requestMagicLink } from "@/lib/api";
import {
  AuthError,
  AuthField,
  AuthForm,
  AuthShell,
  AuthSubmit,
} from "@/components/auth/AuthShell";

// Chrome comes entirely from AuthShell, shared with the guest sign-in at
// app/account/login so the two cannot drift again. This page owns only the
// dev-status probe, the field set and the submit handler.
//
// Signup still carries the older left-aligned max-w-sm chrome this page used to
// share with it, along with its two-panel plan preview. That is the next screen
// to move onto the shell, together with verify and check-email.
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
    <AuthShell
      heading="Welcome back"
      subhead="Sign in to your property dashboard."
      footer={
        <>
          New here?{" "}
          <Link href="/signup" className="font-medium text-brand-violet">
            Create an account
          </Link>
        </>
      }
    >
      <AuthForm onSubmit={handleSubmit}>
        <AuthField
          label="Email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
        />

        {mode === "demo" ? (
          <AuthField
            label="Password"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        ) : null}

        {error ? <AuthError>{error}</AuthError> : null}

        <AuthSubmit disabled={submitting || mode === null}>
          {buttonLabel(mode, submitting)}
        </AuthSubmit>
      </AuthForm>
    </AuthShell>
  );
}

function buttonLabel(mode: Mode, submitting: boolean): string {
  if (mode === "magic-link") return submitting ? "Sending link" : "Email me a link";
  return submitting ? "Signing in" : "Sign in";
}
