"use client";

import Link from "next/link";
import { useState } from "react";
import { completeStripeConnectDemo } from "@/lib/api";

// Simulated "Connect with Stripe" step. Stripe isn't configured in this env, so
// instead of a dead button we stage a convincing Connect handoff and then mark
// the merchant connected via the demo-complete endpoint (mirrors the demo path
// the rest of the app uses).

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Phase = "idle" | "redirecting" | "verifying" | "done" | "error";

export function ConnectStripeStep() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleConnect() {
    setError(null);
    setPhase("redirecting");
    try {
      await sleep(1100); // "Redirecting to Stripe…"
      setPhase("verifying");
      await sleep(900); // "Verifying your details…"
      await completeStripeConnectDemo();
      setPhase("done");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not connect Stripe. Try again.",
      );
      setPhase("idle");
    }
  }

  if (phase === "done") {
    return (
      <div className="card p-8 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
          ✓
        </div>
        <h2 className="mt-4 text-lg font-medium">Stripe connected</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Payouts are set up. You can take payment plans and get paid out on
          arrival.
        </p>
        <Link
          href="/onboarding/plan-rules"
          className="btn-primary mt-6 inline-block"
        >
          Continue
        </Link>
      </div>
    );
  }

  const busy = phase === "redirecting" || phase === "verifying";

  return (
    <div className="card overflow-hidden">
      {/* Stripe-styled panel */}
      <div className="bg-[#635BFF] px-8 py-7 text-white">
        <div className="text-sm font-medium opacity-90">Stripe</div>
        <h2 className="mt-2 text-xl font-semibold">
          Get paid out with Stripe
        </h2>
        <p className="mt-1 text-sm text-white/80">
          Bliss partners with Stripe for secure payments and payouts to your
          bank. Connect your account to start taking payment plans.
        </p>
      </div>

      <div className="p-8">
        <ul className="space-y-2 text-sm text-ink-muted">
          <li className="flex gap-2">
            <span className="text-[#635BFF]">✓</span> Bank-grade KYB and identity
            verification
          </li>
          <li className="flex gap-2">
            <span className="text-[#635BFF]">✓</span> ACH payouts on arrival,
            minus a small flat fee
          </li>
          <li className="flex gap-2">
            <span className="text-[#635BFF]">✓</span> Funds never touch the
            Bliss balance sheet
          </li>
        </ul>

        {error ? (
          <p className="mt-5 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}

        <button
          type="button"
          onClick={handleConnect}
          disabled={busy}
          className="mt-6 w-full rounded-md bg-[#635BFF] px-6 py-3 font-medium text-white transition-colors hover:bg-[#5249e5] disabled:opacity-70"
        >
          {phase === "redirecting"
            ? "Redirecting to Stripe…"
            : phase === "verifying"
              ? "Verifying your details…"
              : "Connect with Stripe"}
        </button>

        <p className="mt-3 text-center text-[11px] text-ink-muted">
          Demo mode — simulated Connect, no real charges or bank details.
        </p>
      </div>
    </div>
  );
}
