"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  devCustomerLogin,
  fetchGuestDevAuthStatus,
  requestCustomerMagicLink,
} from "@/lib/publicApi";
import {
  AuthError,
  AuthField,
  AuthForm,
  AuthSubmit,
} from "@/components/auth/AuthShell";

// Slots into AuthShell from app/account/login. Field shape, spacing, error box
// and submit button are the shared ones, identical to the merchant sign-in.
//
// The password field is gone. It was never checked — the old handler looked the
// email up and accepted whatever was typed — so it implied a security property
// that did not exist. Sign-in is now a magic link, the same primitive the
// merchant side uses.
//
// Which path is live is read at runtime from the backend rather than baked in,
// mirroring the merchant page: flipping BLISS_DEMO_LOGIN switches this form
// over with no redeploy. null = still asking.
type Mode = "demo" | "magic-link" | null;

export function LoginForm() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // A failed probe lands on the magic-link path rather than offering a
    // shortcut that would 404.
    fetchGuestDevAuthStatus()
      .then((s) => setMode(s.devLoginEnabled ? "demo" : "magic-link"))
      .catch(() => setMode("magic-link"));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);

    if (mode === "demo") {
      const result = await devCustomerLogin(email);
      if (!result.ok) {
        setError(result.error.message);
        setBusy(false);
        return;
      }
      router.push("/account");
      router.refresh();
      return;
    }

    const result = await requestCustomerMagicLink(email);
    if (!result.ok) {
      // Includes the unchanged not-found copy for an email with no account.
      setError(result.error.message);
      setBusy(false);
      return;
    }
    router.push(`/account/check-email?email=${encodeURIComponent(email)}`);
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

      {error ? <AuthError>{error}</AuthError> : null}

      <AuthSubmit disabled={busy || mode === null}>
        {buttonLabel(mode, busy)}
      </AuthSubmit>
    </AuthForm>
  );
}

function buttonLabel(mode: Mode, busy: boolean): string {
  if (mode === "magic-link") return busy ? "Sending link" : "Email me a link";
  return busy ? "Signing in" : "Sign in";
}
