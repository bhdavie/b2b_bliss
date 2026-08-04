"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { attemptCustomerLogin } from "@/lib/publicApi";
import {
  AuthError,
  AuthField,
  AuthForm,
  AuthSubmit,
} from "@/components/auth/AuthShell";

// Slots into AuthShell from app/account/login. Field shape, spacing, error box
// and submit button are the shared ones, identical to the merchant sign-in.
export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const result = await attemptCustomerLogin({ email, password });
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    router.push("/account");
    router.refresh();
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
      <AuthField
        label="Password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="current-password"
        required
      />

      {error ? <AuthError>{error}</AuthError> : null}

      <AuthSubmit disabled={busy}>{busy ? "Signing in" : "Sign in"}</AuthSubmit>
    </AuthForm>
  );
}
