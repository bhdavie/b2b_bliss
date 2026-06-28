"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { attemptCustomerLogin } from "@/lib/publicApi";

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
        <span className="mb-1 block text-xs uppercase tracking-wider text-ink-muted">
          Email
        </span>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
          className="w-full rounded-none border border-brand-neutral bg-white px-3 py-2.5 focus:border-brand-navy focus:outline-none"
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs uppercase tracking-wider text-ink-muted">
          Password
        </span>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
          className="w-full rounded-none border border-brand-neutral bg-white px-3 py-2.5 focus:border-brand-navy focus:outline-none"
        />
      </label>

      {error ? (
        <div role="alert" className="rounded-none border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          {error}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-none bg-brand-purple px-4 py-3 text-center text-sm font-medium text-white shadow-sm transition hover:bg-brand-purple-dark disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? "Signing in…" : "Sign in"}
      </button>

      <p className="text-center text-xs text-ink-muted">
        Demo: any password works. Authentication only validates the email.
      </p>
    </form>
  );
}
