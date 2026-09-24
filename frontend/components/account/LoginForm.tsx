"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  devCustomerLogin,
  fetchGuestDevAuthStatus,
  guestPasswordLogin,
  requestCustomerMagicLink,
} from "@/lib/publicApi";
import {
  AuthError,
  AuthField,
  AuthForm,
  AuthSubmit,
} from "@/components/auth/AuthShell";

// Slots into AuthShell from app/account/login. Field shape, spacing, error box
// and submit button are the shared ones, identical to the merchant sign-in, and
// so is the field set: email and password with "Email me a sign-in link
// instead" below whenever a password can sign in, and a pure magic-link form
// otherwise.
//
// A password can sign in in two cases. Demo mode (dev-login open), where the
// value is not checked, as on the merchant page. And the TEMPORARY demo
// password, where it is checked, and only allowlisted guest accounts get in.
// Real guests have no password; their way in is the link.
//
// Which path is live is read at runtime from the backend rather than baked in,
// mirroring the merchant page. null = still asking.
type Mode = "demo" | "magic-link" | null;

export function LoginForm() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // TEMPORARY DEMO PASSWORD - remove with the branch in handleSubmit.
  const [masterPasswordEnabled, setMasterPasswordEnabled] = useState(false);

  useEffect(() => {
    // A failed probe lands on the magic-link path rather than offering a
    // shortcut that would 404.
    fetchGuestDevAuthStatus()
      .then((s) => {
        setMode(s.devLoginEnabled ? "demo" : "magic-link");
        setMasterPasswordEnabled(s.masterPasswordEnabled);
      })
      .catch(() => setMode("magic-link"));
  }, []);

  const showPassword = mode === "demo" || masterPasswordEnabled;

  function signedIn() {
    router.push("/account");
    router.refresh();
  }

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
    setBusy(true);
    const result = await requestCustomerMagicLink(email);
    if (!result.ok) {
      // Includes the unchanged not-found copy for an email with no account.
      setError(result.error.message);
      setBusy(false);
      return;
    }
    router.push(`/account/check-email?email=${encodeURIComponent(email)}`);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!showPassword) {
      // No password on screen, so the form itself is the link request.
      await handleMagicLink();
      return;
    }

    // Blank is rejected rather than quietly sending a link, as on the merchant
    // screen. Asking for a link is its own action below.
    if (!password) {
      setError("Enter your password.");
      return;
    }
    setBusy(true);

    // TEMPORARY DEMO PASSWORD - REMOVE BEFORE REAL MERCHANT OR GUEST
    // ONBOARDING. Tried first when the backend reports it is live. On failure
    // this falls THROUGH in demo mode, as on the merchant page, so local demos
    // still sign in via dev-login whatever was typed.
    if (masterPasswordEnabled) {
      const result = await guestPasswordLogin(email, password);
      if (result.ok) {
        signedIn();
        return;
      }
      if (mode !== "demo") {
        setError("That email and password did not match.");
        setBusy(false);
        return;
      }
    }

    // Demo mode: the password is not validated, and the account must already
    // exist.
    const result = await devCustomerLogin(email);
    if (!result.ok) {
      setError(result.error.message);
      setBusy(false);
      return;
    }
    signedIn();
  }

  return (
    <AuthForm onSubmit={handleSubmit}>
      <AuthField
        label="Email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        autoComplete="email"
        required
      />

      {showPassword ? (
        <AuthField
          label="Password"
          type="password"
          // Required because blank is rejected. The link request below is a
          // plain button, so it bypasses this validation.
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
      ) : null}

      {error ? <AuthError>{error}</AuthError> : null}

      <AuthSubmit disabled={busy || mode === null}>
        {buttonLabel(showPassword, busy)}
      </AuthSubmit>

      {showPassword ? (
        <button
          type="button"
          onClick={handleMagicLink}
          disabled={busy || mode === null}
          className="text-[13px] text-ink-500 underline underline-offset-2 hover:text-ink-700 disabled:opacity-50"
        >
          Email me a sign-in link instead
        </button>
      ) : null}
    </AuthForm>
  );
}

// With a password on screen the submit always signs in; the link request is its
// own action. Without one the form is still the link request itself.
function buttonLabel(showPassword: boolean, busy: boolean): string {
  if (!showPassword) return busy ? "Sending link" : "Email me a link";
  return busy ? "Signing in" : "Sign in";
}
