"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  devLogin,
  fetchDevAuthStatus,
  passwordLogin,
  requestMagicLink,
} from "@/lib/api";
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
  // TEMPORARY MASTER PASSWORD BYPASS - remove with the branch in handleSubmit.
  // Tracked separately from `mode` because the bypass is independent of the
  // demo gate: its whole purpose is the magic-link case, where there would
  // otherwise be no password field to type into.
  const [masterPasswordEnabled, setMasterPasswordEnabled] = useState(false);

  useEffect(() => {
    // fetchDevAuthStatus reports disabled if the probe itself fails, so an
    // unreachable backend lands on the magic-link path rather than offering a
    // sign-in that would 404.
    fetchDevAuthStatus()
      .then((status) => {
        setMode(status.devLoginEnabled ? "demo" : "magic-link");
        setMasterPasswordEnabled(status.masterPasswordEnabled);
      })
      .catch(() => setMode("magic-link"));
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      // TEMPORARY MASTER PASSWORD BYPASS - REMOVE BEFORE REAL MERCHANT OR GUEST
      // ONBOARDING. Tried first whenever a password was typed and the backend
      // reports one is configured. On failure this deliberately falls THROUGH
      // rather than stopping, so the demo path below behaves exactly as it did
      // before the bypass existed: a wrong password in demo mode still signs in
      // via dev-login, as the decorative field always did.
      if (masterPasswordEnabled && password) {
        try {
          await passwordLogin(email, password);
          router.push("/home");
          router.refresh();
          return;
        } catch {
          if (mode !== "demo") {
            // No dev-login to fall back to here, so this is the end of the road.
            throw new Error("That email and password did not match.");
          }
        }
      }
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

        {mode === "demo" || masterPasswordEnabled ? (
          <AuthField
            label="Password"
            type="password"
            // Required in demo mode as before. Optional when the field is here
            // only because MASTER_PASSWORD is set (TEMPORARY): leaving it blank
            // has to stay possible so magic link is still reachable.
            required={mode === "demo"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        ) : null}

        {error ? <AuthError>{error}</AuthError> : null}

        <AuthSubmit disabled={submitting || mode === null}>
          {buttonLabel(mode, submitting, password.length > 0)}
        </AuthSubmit>
      </AuthForm>
    </AuthShell>
  );
}

// hasPassword is TEMPORARY, for the master-password bypass: in magic-link mode
// a typed password means the submit signs in directly rather than emailing a
// link, and the button has to stop promising an email it will not send.
function buttonLabel(mode: Mode, submitting: boolean, hasPassword: boolean): string {
  if (mode === "magic-link" && !hasPassword) {
    return submitting ? "Sending link" : "Email me a link";
  }
  return submitting ? "Signing in" : "Sign in";
}
