"use client";

import Link from "next/link";
import {
  CheckIcon,
  PAYMENT_PROVIDERS,
  PMS_PROVIDERS,
  ProviderLogo,
  type Provider,
} from "./ConnectionsContext";
import { Panel } from "@/components/ui/primitives";
import type {
  OnboardingCloudbeds,
  OnboardingMews,
  OnboardingStateWire,
  PmsType,
} from "@/lib/api";

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
  cloudbeds,
  stripeConnectStatus,
}: {
  pmsType: PmsType;
  onboardingState: OnboardingStateWire;
  mews: OnboardingMews | null;
  cloudbeds: OnboardingCloudbeds | null;
  stripeConnectStatus: string | null;
}) {
  const mewsConnected = pmsType === "mews" && Boolean(mews?.connected);
  const cloudbedsConnected = pmsType === "cloudbeds" && Boolean(cloudbeds?.connected);
  const stripeConnected = stripeConnectStatus === "charges_enabled";
  const pmsChosen = onboardingState !== "created";

  return (
    <Panel className="px-7 py-2">
      {/* Payments: reflect the PMS rail when connected, else Stripe payouts. */}
      {mewsConnected ? (
        <Row
          label="Payments"
          subtext={
            mews?.currency ? `Charged through Mews in ${mews.currency}` : "Charged through Mews"
          }
          logo={MEWS}
          right={<ConnectedTag />}
        />
      ) : cloudbedsConnected ? (
        <Row
          label="Payments"
          subtext={
            cloudbeds?.currency
              ? `Charged through Cloudbeds in ${cloudbeds.currency}`
              : "Charged through Cloudbeds"
          }
          logo={CLOUDBEDS}
          right={<ConnectedTag />}
        />
      ) : stripeConnected ? (
        <Row label="Payments" logo={STRIPE} right={<ConnectedTag />} />
      ) : (
        <Row
          label="Payments"
          right={
            <SetUp
              href={
                pmsType === "cloudbeds"
                  ? "/onboarding/connect-cloudbeds"
                  : "/onboarding/connect-stripe"
              }
            />
          }
        />
      )}

      {/* Property system: the chosen PMS. */}
      {mewsConnected ? (
        <Row
          label="Property system"
          subtext={mews?.enterpriseName ?? undefined}
          logo={MEWS}
          right={<ConnectedTag />}
        />
      ) : cloudbedsConnected ? (
        <Row
          label="Property system"
          subtext={cloudbeds?.propertyName ?? undefined}
          logo={CLOUDBEDS}
          right={<ConnectedTag />}
        />
      ) : pmsType === "mews" ? (
        <Row label="Property system" logo={MEWS} right={<SetUp href="/onboarding/connect-mews" />} />
      ) : pmsType === "cloudbeds" ? (
        <Row
          label="Property system"
          logo={CLOUDBEDS}
          right={<SetUp href="/onboarding/connect-cloudbeds" />}
        />
      ) : pmsChosen ? (
        <Row label="Property system" right={<InfoTag text="Stripe only, no property system" />} />
      ) : (
        <Row label="Property system" right={<SetUp href="/onboarding/pms" />} />
      )}
    </Panel>
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
    <div className="flex flex-col gap-3.5 border-b border-sand-100 py-6 last:border-b-0">
      <div className="flex items-center justify-between gap-5">
        <div className="text-[19px] font-medium tracking-[-0.012em] text-ink-900">
          {label}
        </div>
        <div className="flex flex-none items-center gap-2">
          {logo ? <ProviderLogo provider={logo} className="h-[22px]" /> : null}
          {right}
        </div>
      </div>
      {subtext ? (
        <div className="truncate text-base text-ink-400">{subtext}</div>
      ) : null}
    </div>
  );
}

function ConnectedTag() {
  return (
    <span className="inline-flex items-center gap-1 text-base font-medium text-brand-violet">
      <CheckIcon className="h-4 w-4" />
      Connected
    </span>
  );
}

function InfoTag({ text }: { text: string }) {
  return <span className="text-base text-ink-400">{text}</span>;
}

function SetUp({ href }: { href: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-2 text-base text-ink-400 no-underline transition-colors hover:text-brand-violet hover:no-underline"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-sand-500" aria-hidden="true" />
      Not connected · Set up
    </Link>
  );
}
