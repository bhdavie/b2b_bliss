"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  adminDevLogin,
  adminPasswordLogin,
  fetchDevAuthStatus,
  requestAdminMagicLink,
} from "@/lib/api";
import {
  AuthError,
  AuthField,
  AuthForm,
  AuthShell,
  AuthSubmit,
} from "@/components/auth/AuthShell";

// Chrome comes entirely from AuthShell, shared with the merchant and guest
// sign-ins, so this screen needs no design of its own and cannot drift from
// them. This page owns only the dev-status probe, the field set and the submit.
//
// The probe reads the MERCHANT dev-status endpoint. There is no admin one: the
// backend gates both dev-logins on the same demoLoginEnabled value, computed
// once in BlissApplication and passed to AuthResource and AdminAuthResource
// alike, so this answer is the correct one for both. If the admin resource ever
// gains its own gate, this needs its own probe.
//
// Note the admin dev-login is NOT the merchant's "any email" bypass: the
// backend requires an existing admin_users row and answers 401 otherwise, so
// the demo path here still cannot create an admin.
type Mode = "demo" | "magic-link" | null;

export default function AdminLoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  // TEMPORARY MASTER PASSWORD BYPASS - remove with the branch in handleSubmit.
  // Same probe as the merchant page, which already serves both surfaces.
  const [masterPasswordEnabled, setMasterPasswordEnabled] = useState(false);

  useEffect(() => {
    fetchDevAuthStatus()
      .then((status) => {
        setMode(status.devLoginEnabled ? "demo" : "magic-link");
        setMasterPasswordEnabled(status.masterPasswordEnabled);
      })
      .catch(() => setMode("magic-link"));
  }, []);

  // On screen when demo mode wants it, or when the TEMPORARY master password is
  // configured. Neither holding leaves the form a pure magic-link request.
  const showPassword = mode === "demo" || masterPasswordEnabled;

  /**
   * Explicit "email me a link" action, separate from the form submit, on a
   * type="button" trigger so the required password field cannot block it.
   */
  async function handleMagicLink() {
    setError(null);
    if (!email) {
      setError("Enter your email first.");
      return;
    }
    setSubmitting(true);
    try {
      await requestAdminMagicLink(email);
      setSent(true);
      setSubmitting(false);
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
        // Blank is rejected rather than quietly sending a link, as on the
        // merchant screen. Asking for a link is its own action below.
        if (!password) {
          setError("Enter your password.");
          setSubmitting(false);
          return;
        }
        // TEMPORARY MASTER PASSWORD BYPASS - REMOVE BEFORE REAL MERCHANT OR
        // GUEST ONBOARDING. Falls through to the unchanged demo path on failure.
        // Neither path can create an admin - the backend 401s an unknown
        // address on both.
        if (masterPasswordEnabled) {
          try {
            await adminPasswordLogin(email, password);
            router.push("/admin");
            router.refresh();
            return;
          } catch {
            if (mode !== "demo") {
              throw new Error("That email and password did not match.");
            }
          }
        }
        if (mode === "demo") {
          // The password is not validated here. The address is what the backend
          // checks, and it must already be an admin_users row.
          await adminDevLogin(email);
          router.push("/admin");
          router.refresh();
          return;
        }
        throw new Error("That email and password did not match.");
      }
      await requestAdminMagicLink(email);
      setSent(true);
      setSubmitting(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
      setSubmitting(false);
    }
  }

  return (
    <AuthShell
      heading="Bliss internal"
      subhead="Sign in to the admin console."
    >
      {sent ? (
        // No /check-email route for this surface, and there is no signup to
        // offer, so the confirmation lives inline. Deliberately says nothing
        // about whether the address is an admin: the backend answers 204 either
        // way so the short internal list cannot be enumerated from here.
        <p className="text-[15px] text-ink-500">
          If that address belongs to a Bliss admin, a sign-in link is on its way.
          It expires shortly, so use it soon.
        </p>
      ) : (
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
              // Required now that blank is rejected. The link request below is a
              // plain button, so it bypasses this validation.
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
      )}
    </AuthShell>
  );
}

// With a password on screen the submit always signs in; the link request is its
// own action. Without one the form is still the link request itself.
function buttonLabel(showPassword: boolean, submitting: boolean): string {
  if (!showPassword) return submitting ? "Sending link" : "Email me a link";
  return submitting ? "Signing in" : "Sign in";
}
