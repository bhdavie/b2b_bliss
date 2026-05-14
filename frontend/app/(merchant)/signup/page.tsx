"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { requestMagicLink } from "@/lib/api";

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await requestMagicLink(email);
      router.push(`/check-email?email=${encodeURIComponent(email)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send link");
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <form onSubmit={handleSubmit} className="w-full max-w-sm flex flex-col gap-4">
        <header>
          <div className="text-xl font-medium tracking-tight">bliss</div>
          <h1 className="mt-4 text-lg font-medium">Create your merchant account</h1>
          <p className="mt-1 text-ink-muted">
            We will email you a link to confirm your address.
          </p>
        </header>

        <label className="flex flex-col gap-1.5">
          <span className="label">Email</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="input"
            autoComplete="email"
          />
        </label>

        {error ? (
          <div className="text-xs text-red-600" role="alert">
            {error}
          </div>
        ) : null}

        <button type="submit" disabled={submitting} className="btn-primary">
          {submitting ? "Sending" : "Continue"}
        </button>

        <p className="text-xs text-ink-soft text-center">
          Already have an account?{" "}
          <Link href="/login" className="text-lavender-500">
            Sign in
          </Link>
        </p>
      </form>
    </main>
  );
}
