"use client";

import { useState } from "react";
import {
  createStripeAccountLink,
  type StripeStatus,
} from "@/lib/api";

type Variant = "card" | "inline";

export function StripeConnectCard({
  status,
  variant = "card",
}: {
  status: StripeStatus;
  variant?: Variant;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startStripe() {
    setBusy(true);
    setError(null);
    const result = await createStripeAccountLink();
    if ("error" in result) {
      setError(result.message);
      setBusy(false);
      return;
    }
    window.location.href = result.url;
  }

  const wrapperClass =
    variant === "card" ? "card p-5" : "card-subtle";

  return (
    <div className={wrapperClass}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs text-ink-muted">Stripe Connect</div>
          <div className="mt-1 flex items-center gap-2">
            <StatusPill status={status.status} />
            {!status.configured && (
              <span className="text-[10px] uppercase tracking-wide text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                Backend not configured
              </span>
            )}
          </div>
          <p className="mt-2 text-sm text-ink-muted">
            <StatusCopy status={status} />
          </p>
        </div>
      </div>

      {error ? (
        <div className="mt-3 text-xs text-red-600" role="alert">
          {error}
        </div>
      ) : null}

      <div className="mt-4">
        {status.status === "charges_enabled" ? (
          <div className="text-xs text-ink-soft">
            You can create bookings and accept payment plans.
          </div>
        ) : (
          <button
            type="button"
            className="btn-primary"
            disabled={busy || !status.configured}
            onClick={startStripe}
          >
            {busy
              ? "Redirecting"
              : status.status === "not_started"
                ? "Connect with Stripe"
                : status.status === "restricted"
                  ? "Resolve issues"
                  : "Continue Stripe setup"}
          </button>
        )}
      </div>

      {status.accountId ? (
        <div className="mt-3 text-[11px] text-ink-soft font-mono">
          {status.accountId}
        </div>
      ) : null}
    </div>
  );
}

function StatusPill({ status }: { status: StripeStatus["status"] }) {
  const config: Record<
    StripeStatus["status"],
    { label: string; className: string }
  > = {
    not_started: {
      label: "Not started",
      className: "bg-surface-subtle text-ink-muted",
    },
    in_progress: {
      label: "In progress",
      className: "bg-lavender-100 text-lavender-700",
    },
    charges_enabled: {
      label: "Active",
      className: "bg-emerald-100 text-emerald-700",
    },
    restricted: {
      label: "Restricted",
      className: "bg-red-100 text-red-700",
    },
  };
  const c = config[status];
  return (
    <span
      className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full font-medium ${c.className}`}
    >
      {c.label}
    </span>
  );
}

function StatusCopy({ status }: { status: StripeStatus }) {
  if (!status.configured) {
    return (
      <>
        Stripe is scaffolded but not yet keyed up on the backend. Set{" "}
        <span className="font-mono">STRIPE_SECRET_KEY</span> to enable the
        Connect flow.
      </>
    );
  }
  switch (status.status) {
    case "not_started":
      return (
        <>
          Connect a Stripe account to enable customer payouts. We use Stripe
          Connect Express. You will be sent to a Stripe-hosted flow.
        </>
      );
    case "in_progress":
      return (
        <>
          Your Stripe onboarding is in progress. Finish the remaining steps to
          start taking bookings.
        </>
      );
    case "charges_enabled":
      return (
        <>
          Connected. Payouts will route to your bank account on each completed
          plan.
        </>
      );
    case "restricted":
      return (
        <>
          Stripe flagged something with your account
          {status.disabledReason ? ` (${status.disabledReason})` : ""}. Resolve
          the open requirements in the Stripe portal.
        </>
      );
  }
}
