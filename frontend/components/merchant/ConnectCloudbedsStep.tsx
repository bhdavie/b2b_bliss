"use client";

import { useState } from "react";
import { cloudbedsOAuthStartUrl } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/primitives";

// Cloudbeds connects via OAuth, so "connect" is a full-page redirect to the
// backend start endpoint (which 302s to the Cloudbeds authorize page), not a
// token form like Mews. On return the onboarding status reports the connection
// and this step renders its connected state.
//
// Both states take the Mews step's chrome, since the two screens are the same
// screen with a different provider in it.

export type CloudbedsConnected = {
  propertyName: string | null;
  currency: string | null;
};

export function ConnectCloudbedsStep({
  alreadyConnected,
}: {
  alreadyConnected?: CloudbedsConnected | null;
}) {
  const [redirecting, setRedirecting] = useState(false);

  function connect() {
    setRedirecting(true);
    // OAuth redirect: a real navigation, not a fetch. The backend endpoint is
    // merchant-authenticated via the session cookie sent on this top-level nav.
    window.location.href = cloudbedsOAuthStartUrl();
  }

  if (alreadyConnected) {
    return (
      <Panel className="mx-auto w-full max-w-[560px] items-center gap-5 px-10 pb-10 pt-9 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-violet text-xl text-white">
          ✓
        </div>
        <h2 className="text-[28px] font-medium tracking-[-0.02em] text-ink-900">
          Cloudbeds connected
        </h2>
        <p className="max-w-[560px] text-lg leading-[1.6] text-ink-500">
          {alreadyConnected.propertyName ? (
            <>
              Linked to{" "}
              <span className="font-medium text-ink-900">{alreadyConnected.propertyName}</span>
            </>
          ) : (
            "Your Cloudbeds property is connected"
          )}
          {alreadyConnected.currency ? ` · charging in ${alreadyConnected.currency}` : ""}.
        </p>
        <Button href="/onboarding/plan-rules" variant="merchant" className="mt-2">
          Continue
        </Button>
      </Panel>
    );
  }

  return (
    <Panel className="px-8 pb-8 pt-[30px]">
      <h2 className="text-2xl font-medium tracking-[-0.02em] text-ink-900">Connect Cloudbeds</h2>
      <p className="mt-2.5 max-w-[760px] text-[17px] leading-[1.55] text-ink-500">
        Authorize Bliss in your Cloudbeds account. You will be sent to Cloudbeds to sign in
        and approve access, then returned here.
      </p>

      <div className="mt-8 flex flex-wrap items-center gap-4 border-t border-sand-100 pt-6">
        <Button
          type="button"
          onClick={connect}
          disabled={redirecting}
          variant="merchant"
          className="disabled:opacity-60"
        >
          {redirecting ? "Redirecting to Cloudbeds" : "Connect Cloudbeds"}
        </Button>
      </div>
    </Panel>
  );
}
