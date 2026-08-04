"use client";

import { BlissWordmark } from "@/components/BlissWordmark";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { requestMagicLink } from "@/lib/api";
import { SignupPlanPreview } from "@/components/merchant/SignupPlanPreview";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

// Two-panel split at lg and up: the form on the left at its existing width, a
// static mock of the guest plan detail on the right. Below lg the right panel is
// not rendered at all and the single grid cell fills the viewport, which leaves
// the form exactly as it was — same wrapper classes, same max-w-sm, centred.

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
    <main className="min-h-screen font-inter lg:grid lg:grid-cols-[minmax(0,440px)_minmax(0,1fr)]">
      <div className="flex min-h-screen items-center justify-center px-6 py-16 lg:min-h-0">
        <form onSubmit={handleSubmit} className="w-full max-w-sm flex flex-col gap-4">
          <header>
            <BlissWordmark className="text-xl tracking-tight text-brand-violet" />
            <h1 className="mt-4 text-lg font-medium">Create your merchant account</h1>
            <p className="mt-1 text-ink-muted">
              We will email you a link to confirm your address.
            </p>
          </header>

          <label className="flex flex-col gap-1.5">
            <span className="label">Email</span>
            <Input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
            />
          </label>

          {error ? (
            <div className="text-xs text-red-600" role="alert">
              {error}
            </div>
          ) : null}

          <Button type="submit" disabled={submitting} variant="primary">
            {submitting ? "Sending" : "Continue"}
          </Button>

          <p className="text-xs text-ink-muted text-center">
            Already have an account?{" "}
            <Link href="/login" className="text-brand-purple">
              Sign in
            </Link>
          </p>
        </form>
      </div>

      <div className="hidden border-l border-sand-200 bg-sand-50 px-12 py-16 lg:flex lg:items-center lg:justify-center">
        <SignupPlanPreview />
      </div>
    </main>
  );
}
