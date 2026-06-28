"use client";

import Link from "next/link";
import {
  CheckIcon,
  ProviderLogo,
  useConnections,
  type Connection,
} from "./ConnectionsContext";

// At-a-glance connection status for Home. Reads the same shared state Account
// settings writes to, so connecting in one place reflects here immediately.
export function ConnectionGlance() {
  const { payments, pms } = useConnections();
  return (
    <div className="border-y border-brand-neutral">
      <GlanceRow label="Payments" conn={payments} />
      <div className="border-t border-brand-neutral" />
      <GlanceRow label="Property system" conn={pms} />
    </div>
  );
}

function GlanceRow({ label, conn }: { label: string; conn: Connection }) {
  const connected = conn.state === "connected";
  return (
    <div className="flex items-center justify-between gap-3 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <span className="text-sm font-medium text-brand-navy">{label}</span>
        {connected ? <ProviderLogo provider={conn.selected} className="h-5" /> : null}
      </div>
      {connected ? (
        <span className="inline-flex shrink-0 items-center gap-1 text-sm text-brand-purple">
          <CheckIcon className="h-4 w-4" />
          Connected
        </span>
      ) : (
        <Link
          href="/dashboard"
          className="inline-flex shrink-0 items-center gap-2 text-sm text-brand-navy/55 transition-colors hover:text-brand-purple"
        >
          <span className="h-1.5 w-1.5 bg-brand-dusty" aria-hidden="true" />
          Not connected · Set up
        </Link>
      )}
    </div>
  );
}
