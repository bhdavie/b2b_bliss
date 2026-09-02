"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { adminDevLogin, fetchDevAuthStatus, requestAdminMagicLink } from "@/lib/api";
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

  useEffect(() => {
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
        // The password is decorative and not validated, as on the merchant
        // screen. The address is what the backend checks.
        await adminDevLogin(email);
        router.push("/admin");
        router.refresh();
        return;
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
      )}
    </AuthShell>
  );
}

function buttonLabel(mode: Mode, submitting: boolean): string {
  if (mode === "magic-link") return submitting ? "Sending link" : "Email me a link";
  return submitting ? "Signing in" : "Sign in";
}
