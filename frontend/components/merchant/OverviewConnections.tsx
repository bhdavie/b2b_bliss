"use client";

import Link from "next/link";
import {
  CheckIcon,
  PMS_PROVIDERS,
  ProviderLogo,
  type Provider,
} from "./ConnectionsContext";
import type { OnboardingCloudbeds, OnboardingMews, PmsType } from "@/lib/api";

// At-a-glance connection status for the Overview, driven by the property's REAL
// onboarding state (pmsType + the PMS connection) rather than the simulated
// demo store.
//
// One row now, not two. The Payments row was removed along with the payment
// processor connection: a property connects its property system, and that
// system executes the charge, so there was never a second connection to report.
// `onboardingState` and `stripeConnectStatus` went with it — the first only fed
// the removed "Stripe only, no property system" branch, the second only the
// removed Payments row.

const MEWS = PMS_PROVIDERS.find((p) => p.name === "Mews")!;
const CLOUDBEDS = PMS_PROVIDERS.find((p) => p.name === "Cloudbeds")!;

export function OverviewConnections({
  pmsType,
  mews,
  cloudbeds,
}: {
  pmsType: PmsType;
  mews: OnboardingMews | null;
  cloudbeds: OnboardingCloudbeds | null;
}) {
  const mewsConnected = pmsType === "mews" && Boolean(mews?.connected);
  const cloudbedsConnected = pmsType === "cloudbeds" && Boolean(cloudbeds?.connected);

  return (
    // No panel of its own: the Overview wraps this in the filled section block
    // together with the heading, so drawing one here would nest sand-50 inside
    // sand-50.
    <div className="flex flex-col">
      {/* The Payments row is gone. A property no longer connects a payment
          processor: its PMS executes the charge, so "payments" and "property
          system" named the same connection twice, and the row's not-connected
          state pointed at /onboarding/connect-stripe, a route that no longer
          exists. The currency the rail charges in — the one thing the Payments
          row carried that this one did not — has moved onto the subtext below. */}

      {/* Property system: the chosen PMS. */}
      {mewsConnected ? (
        <Row
          label="Property system"
          subtext={joinSubtext(mews?.enterpriseName, mews?.currency, "Mews")}
          logo={MEWS}
          right={<ConnectedTag />}
        />
      ) : cloudbedsConnected ? (
        <Row
          label="Property system"
          subtext={joinSubtext(cloudbeds?.propertyName, cloudbeds?.currency, "Cloudbeds")}
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
      ) : (
        // Covers `none` (nothing chosen yet) and the legacy `stripe` rail. Both
        // want the same thing: go pick a property system. The old branch here
        // showed "Stripe only, no property system" for a chosen-but-unconnected
        // property, which no longer describes a state a property can enter.
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
    <div className="flex flex-col gap-3.5 border-b border-sand-100 py-4 last:border-b-0">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[14px] tracking-[-0.012em] text-ink-900">
          {label}
        </div>
        <div className="flex flex-none items-center gap-2">
          {logo ? <ProviderLogo provider={logo} className="h-[22px]" /> : null}
          {right}
        </div>
      </div>
      {subtext ? (
        <div className="truncate text-[14px] text-ink-500">{subtext}</div>
      ) : null}
    </div>
  );
}

function ConnectedTag() {
  return (
    <span className="inline-flex items-center gap-1 text-[14px] text-brand-violet">
      <CheckIcon className="h-4 w-4" />
      Connected
    </span>
  );
}

/**
 * Property name plus the currency the rail charges in, e.g.
 * "Gross pricing UK · charged in GBP". The currency line used to live on the
 * Payments row; folding it in here is what keeps it visible now that the row is
 * gone. Falls back to the provider name when the connection reports no
 * enterprise, and drops the currency clause when there is none.
 */
function joinSubtext(
  name: string | null | undefined,
  currency: string | null | undefined,
  provider: string,
): string {
  const left = name?.trim() || provider;
  return currency?.trim() ? `${left} · charged in ${currency.trim()}` : left;
}

function SetUp({ href }: { href: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-2 text-[14px] text-ink-500 no-underline transition-colors hover:text-brand-violet hover:no-underline"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-sand-500" aria-hidden="true" />
      Not connected · Set up
    </Link>
  );
}
