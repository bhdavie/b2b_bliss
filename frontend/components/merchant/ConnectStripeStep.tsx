"use client";

import { useEffect, useState } from "react";
import {
  completeStripeConnectStandardDemo,
  fetchStripeConnectStatus,
  startStripeConnect,
  type StripeConnectStatus,
} from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/primitives";

// "Connect with Stripe" step of the onboarding wizard. Sends the merchant to
// Stripe's hosted Standard onboarding and asks to be returned here, so the
// wizard can carry on to plan rules. With no Stripe key on the backend there is
// no hosted flow to run, so it falls back to the demo-complete endpoint.
//
// The Stripe-purple hero panel and Stripe-purple button are gone. Account
// settings already solved "connect Stripe from a Bliss surface" and solves it
// with Bliss chrome and the violet pill, so this uses that: the panel is a plain
// Panel, the eyebrow is the section-label treatment, and the ticks carry the
// violet accent. Every string is unchanged, including the "Stripe" eyebrow.

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
      <Panel className="mx-auto w-full max-w-[560px] items-center gap-5 px-10 pb-10 pt-9 text-center">
        <ConnectedMark />
        <h2 className="text-[28px] font-medium tracking-[-0.02em] text-ink-900">
          Stripe connected
        </h2>
        <p className="max-w-[560px] text-lg leading-[1.6] text-ink-500">
          Payouts are set up. You can take payment plans and get paid out on
          arrival.
        </p>
        <Button
          href="/onboarding/plan-rules"
          variant="primary"
          className="mt-2"
        >
          Continue
        </Button>
      </Panel>
    );
  }

  const busy = phase === "redirecting";
  const resuming =
    connect?.status === "in_progress" || connect?.status === "restricted";

  return (
    <Panel className="px-8 pb-8 pt-[30px]">
      <div className="text-[13px] uppercase tracking-[0.08em] text-ink-400">
        Stripe
      </div>
      <h2 className="mt-2.5 text-2xl font-medium tracking-[-0.02em] text-ink-900">
        Get paid out with Stripe
      </h2>
      <p className="mt-2.5 max-w-[760px] text-[17px] leading-[1.55] text-ink-500">
        Bliss partners with Stripe for secure payments and payouts to your bank.
        Connect your account to start taking payment plans.
      </p>

      <ul className="mt-7 space-y-3 text-[17px] text-ink-500">
        <li className="flex gap-3">
          <span className="text-brand-violet">✓</span> Bank-grade KYB and
          identity verification
        </li>
        <li className="flex gap-3">
          <span className="text-brand-violet">✓</span> ACH payouts on arrival,
          minus a small flat fee
        </li>
        <li className="flex gap-3">
          <span className="text-brand-violet">✓</span> Funds never touch the
          Bliss balance sheet
        </li>
      </ul>

      {error ? (
        <p className="mt-6 rounded-xl bg-red-50 px-4 py-3 text-base text-red-700">
          {error}
        </p>
      ) : null}

      <div className="mt-8 flex flex-wrap items-center gap-4 border-t border-sand-100 pt-6">
        <Button
          type="button"
          onClick={handleConnect}
          disabled={busy}
          variant="merchant"
        >
          {phase === "redirecting"
            ? "Redirecting to Stripe…"
            : resuming
              ? "Continue Stripe setup"
              : "Connect with Stripe"}
        </Button>

        {connect && !connect.configured ? (
          <p className="text-[17px] text-ink-400">
            Demo mode. Simulated Connect, no real charges or bank details.
          </p>
        ) : null}
      </div>
    </Panel>
  );
}

// The connected tick. The design has no success glyph of its own; this is
// OnboardingChecklist's completed step chip (violet fill, white check) at the
// size the old emerald circle occupied, so "done" reads in the accent the rest
// of the funnel already uses for a finished step.
function ConnectedMark() {
  return (
    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-violet text-xl text-white">
      ✓
    </div>
  );
}
