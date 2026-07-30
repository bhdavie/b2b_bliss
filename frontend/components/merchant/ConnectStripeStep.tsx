"use client";

import { useEffect, useState } from "react";
import {
  completeStripeConnectStandardDemo,
  fetchStripeConnectStatus,
  startStripeConnect,
  type StripeConnectStatus,
} from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

// "Connect with Stripe" step of the onboarding wizard. Sends the merchant to
// Stripe's hosted Standard onboarding and asks to be returned here, so the
// wizard can carry on to plan rules. With no Stripe key on the backend there is
// no hosted flow to run, so it falls back to the demo-complete endpoint.

const RETURN_PATH = "/onboarding/connect-stripe";

type Phase = "idle" | "redirecting" | "done" | "error";

export function ConnectStripeStep() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  // Status on mount is what renders the connected state when Stripe returns
  // the merchant to this page.
  const [connect, setConnect] = useState<StripeConnectStatus | null>(null);

  useEffect(() => {
    let active = true;
    fetchStripeConnectStatus()
      .then((status) => {
        if (!active) return;
        setConnect(status);
        if (status.chargesEnabled) setPhase("done");
      })
      .catch(() => {
        // Leave the step in its not-connected state; the button still works.
      });
    return () => {
      active = false;
    };
  }, []);

  async function handleConnect() {
    setError(null);
    setPhase("redirecting");
    try {
      const link = await startStripeConnect(RETURN_PATH);
      if ("error" in link) {
        // No Stripe key on the backend, so there is no hosted flow to send
        // them to. Mark the property connected the way the demo path does.
        setConnect(await completeStripeConnectStandardDemo());
        setPhase("done");
        return;
      }
      window.location.href = link.url;
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not connect Stripe. Try again.",
      );
      setPhase("idle");
    }
  }

  if (phase === "done") {
    return (
      <Card padding="xl" className="text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
          ✓
        </div>
        <h2 className="mt-4 text-lg font-medium">Stripe connected</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Payouts are set up. You can take payment plans and get paid out on
          arrival.
        </p>
        <Button
          href="/onboarding/plan-rules"
          variant="primary"
          className="mt-6 inline-block"
        >
          Continue
        </Button>
      </Card>
    );
  }

  const busy = phase === "redirecting";
  const resuming =
    connect?.status === "in_progress" || connect?.status === "restricted";

  return (
    <Card className="overflow-hidden">
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
            : resuming
              ? "Continue Stripe setup"
              : "Connect with Stripe"}
        </button>

        {connect && !connect.configured ? (
          <p className="mt-3 text-center text-[11px] text-ink-muted">
            Demo mode. Simulated Connect, no real charges or bank details.
          </p>
        ) : null}
      </div>
    </Card>
  );
}
