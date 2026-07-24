"use client";

import Link from "next/link";
import {
  CheckIcon,
  PAYMENT_PROVIDERS,
  PMS_PROVIDERS,
  ProviderLogo,
  type Provider,
} from "./ConnectionsContext";
import type { OnboardingMews, OnboardingStateWire, PmsType } from "@/lib/api";

// At-a-glance connection status for the Overview, driven by the property's REAL
// onboarding state (pmsType + Mews connection + Stripe status) rather than the
// simulated demo store. A Mews-connected property shows Mews on both rows; a
// Stripe-only property shows its Stripe payout status.

const MEWS = PMS_PROVIDERS.find((p) => p.name === "Mews")!;
const CLOUDBEDS = PMS_PROVIDERS.find((p) => p.name === "Cloudbeds")!;
const STRIPE = PAYMENT_PROVIDERS.find((p) => p.name === "Stripe")!;

export function OverviewConnections({
  pmsType,
  onboardingState,
  mews,
  stripeConnectStatus,
}: {
  pmsType: PmsType;
  onboardingState: OnboardingStateWire;
  mews: OnboardingMews | null;
  stripeConnectStatus: string | null;
}) {
  const mewsConnected = pmsType === "mews" && Boolean(mews?.connected);
  const stripeConnected = stripeConnectStatus === "charges_enabled";
  const pmsChosen = onboardingState !== "created";

  return (
    <div className="border-y border-brand-neutral">
      {/* Payments: reflect the Mews rail when connected, else Stripe payouts. */}
      {mewsConnected ? (
        <Row
          label="Payments"
          subtext={
            mews?.currency ? `Charged through Mews in ${mews.currency}` : "Charged through Mews"
          }
          logo={MEWS}
          right={<ConnectedTag />}
        />
      ) : stripeConnected ? (
        <Row label="Payments" logo={STRIPE} right={<ConnectedTag />} />
      ) : (
        <Row label="Payments" right={<SetUp href="/onboarding/connect-stripe" />} />
      )}

      <div className="border-t border-brand-neutral" />

      {/* Property system: the chosen PMS. */}
      {mewsConnected ? (
        <Row
          label="Property system"
          subtext={mews?.enterpriseName ?? undefined}
          logo={MEWS}
          right={<ConnectedTag />}
        />
      ) : pmsType === "mews" ? (
        <Row label="Property system" logo={MEWS} right={<SetUp href="/onboarding/connect-mews" />} />
      ) : pmsType === "cloudbeds" ? (
        <Row label="Property system" logo={CLOUDBEDS} right={<InfoTag text="Coming soon" />} />
      ) : pmsChosen ? (
        <Row label="Property system" right={<InfoTag text="Stripe only, no property system" />} />
      ) : (
        <Row label="Property system" right={<SetUp href="/onboarding/pms" />} />
      )}
    </div>
  );
}

function Row({
  label,
  subtext,
  logo,
  right,
}: {
  label: string;
  subtext?: string;
  logo?: Provider;
  right: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-brand-navy">{label}</div>
          {subtext ? (
            <div className="mt-0.5 truncate text-xs text-brand-navy/55">{subtext}</div>
          ) : null}
        </div>
        {logo ? <ProviderLogo provider={logo} className="h-5" /> : null}
      </div>
      <div className="shrink-0">{right}</div>
    </div>
  );
}

function ConnectedTag() {
  return (
    <span className="inline-flex items-center gap-1 text-sm text-brand-purple">
      <CheckIcon className="h-4 w-4" />
      Connected
    </span>
  );
}

function InfoTag({ text }: { text: string }) {
  return <span className="text-sm text-brand-navy/55">{text}</span>;
}

function SetUp({ href }: { href: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-2 text-sm text-brand-navy/55 transition-colors hover:text-brand-purple"
    >
      <span className="h-1.5 w-1.5 bg-brand-dusty" aria-hidden="true" />
      Not connected · Set up
    </Link>
  );
}
