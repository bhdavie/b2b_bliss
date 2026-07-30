"use client";

import { useState } from "react";
import { cloudbedsOAuthStartUrl } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

// Cloudbeds connects via OAuth, so "connect" is a full-page redirect to the
// backend start endpoint (which 302s to the Cloudbeds authorize page), not a
// token form like Mews. On return the onboarding status reports the connection
// and this step renders its connected state.

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
      <Card padding="xl" className="text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
          ✓
        </div>
        <h2 className="mt-4 text-lg font-medium text-brand-navy">Cloudbeds connected</h2>
        <p className="mt-1 text-sm text-ink-muted">
          {alreadyConnected.propertyName ? (
            <>
              Linked to{" "}
              <span className="font-medium text-ink">{alreadyConnected.propertyName}</span>
            </>
          ) : (
            "Your Cloudbeds property is connected"
          )}
          {alreadyConnected.currency ? ` · charging in ${alreadyConnected.currency}` : ""}.
        </p>
        <Button href="/onboarding/plan-rules" variant="merchant" className="mt-6 inline-block">
          Continue
        </Button>
      </Card>
    );
  }

  return (
    <Card padding="xl">
      <h2 className="text-lg font-medium text-brand-navy">Connect Cloudbeds</h2>
      <p className="mt-1 text-sm text-ink-muted">
        Authorize Bliss in your Cloudbeds account. You will be sent to Cloudbeds to sign in
        and approve access, then returned here.
      </p>

      <Button
        type="button"
        onClick={connect}
        disabled={redirecting}
        variant="merchant"
        className="mt-6 w-full disabled:opacity-60"
      >
        {redirecting ? "Redirecting to Cloudbeds" : "Connect Cloudbeds"}
      </Button>
    </Card>
  );
}
