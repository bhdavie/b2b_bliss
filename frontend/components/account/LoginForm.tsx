"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { attemptCustomerLogin } from "@/lib/publicApi";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("john@example.com");
  const [password, setPassword] = useState("demo");
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
    <form onSubmit={handleSubmit} className="space-y-4">
      <label className="block">
        <span className="label mb-1 block">
          Email
        </span>
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />
      </label>
      <label className="block">
        <span className="label mb-1 block">
          Password
        </span>
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
      </label>

      {error ? (
        <div role="alert" className="rounded-none border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          {error}
        </div>
      ) : null}

      <Button type="submit" disabled={busy} variant="primary" className="w-full">
        {busy ? "Signing in…" : "Sign in"}
      </Button>

      <p className="text-center text-xs text-ink-400">
        Demo: any password works. Authentication only validates the email.
      </p>
    </form>
  );
}
