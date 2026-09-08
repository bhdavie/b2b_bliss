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

  // The password field is on screen when demo mode wants it, or when the
  // TEMPORARY master password is configured. When neither holds there is no
  // password to type and the form stays a pure magic-link request.
  const showPassword = mode === "demo" || masterPasswordEnabled;

  /**
   * Explicit "email me a link" action, separate from the form submit.
   * type="button" on the trigger, so the required password field does not block
   * it: asking for a link must stay reachable without typing a password.
   */
  async function handleMagicLink() {
    setError(null);
    if (!email) {
      setError("Enter your email first.");
      return;
    }
    setSubmitting(true);
    try {
      await requestMagicLink(email);
      router.push(`/check-email?email=${encodeURIComponent(email)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
      setSubmitting(false);
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (showPassword) {
        // Blank is rejected rather than quietly falling through to a magic
        // link. Submitting this form means "sign me in"; asking for a link is
        // now its own action below, so the two intents cannot be confused.
        if (!password) {
          setError("Enter your password.");
          setSubmitting(false);
          return;
        }
        // TEMPORARY MASTER PASSWORD BYPASS - REMOVE BEFORE REAL MERCHANT OR
        // GUEST ONBOARDING. Tried first when the backend reports one is
        // configured. On failure this deliberately falls THROUGH in demo mode,
        // so local demos behave exactly as they did before the bypass existed:
        // a wrong password still signs in via dev-login.
        if (masterPasswordEnabled) {
          try {
            await passwordLogin(email, password);
            router.push("/home");
            router.refresh();
            return;
          } catch {
            if (mode !== "demo") {
              throw new Error("That email and password did not match.");
            }
          }
        }
        if (mode === "demo") {
          // Demo sign-in: the password is not validated. devLogin establishes
          // the merchant session so the dashboard loads. Always land on the
          // dashboard; incomplete properties see the setup checklist there.
          await devLogin(email);
          router.push("/home");
          router.refresh();
          return;
        }
        throw new Error("That email and password did not match.");
      }
      // No password field on screen at all (no demo gate, no master password),
      // so the form itself is the magic-link request, as it always was.
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

        {showPassword ? (
          <AuthField
            label="Password"
            type="password"
            // Required now that blank is rejected rather than silently sending a
            // link. Magic link stays reachable through its own action below,
            // which is a plain button and so bypasses this validation.
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        ) : null}

        {error ? <AuthError>{error}</AuthError> : null}

        <AuthSubmit disabled={submitting || mode === null}>
          {buttonLabel(showPassword, submitting)}
        </AuthSubmit>

        {showPassword ? (
          <button
            type="button"
            onClick={handleMagicLink}
            disabled={submitting || mode === null}
            className="text-[13px] text-ink-500 underline underline-offset-2 hover:text-ink-700 disabled:opacity-50"
          >
            Email me a sign-in link instead
          </button>
        ) : null}
      </AuthForm>
    </AuthShell>
  );
}

// With a password on screen the submit always signs in, and the link request is
// its own action. Without one the form is still the link request itself.
function buttonLabel(showPassword: boolean, submitting: boolean): string {
  if (!showPassword) return submitting ? "Sending link" : "Email me a link";
  return submitting ? "Signing in" : "Sign in";
}
