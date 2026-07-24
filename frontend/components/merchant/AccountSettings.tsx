"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  CheckIcon,
  PAYMENT_PROVIDERS,
  PMS_PROVIDERS,
  ProviderLogo,
  Spinner,
} from "./ConnectionsContext";
import {
  completeStripeConnectDemo,
  disconnectMews,
  type OnboardingMews,
  type OnboardingStateWire,
  type PmsType,
} from "@/lib/api";

export type AccountInitial = {
  hotelName: string;
  email: string;
  phone: string;
  addressLine1: string;
  addressLine2: string;
  addressCity: string;
  addressState: string;
  addressZip: string;
};

export type AccountConnections = {
  pmsType: PmsType;
  onboardingState: OnboardingStateWire;
  mews: OnboardingMews | null;
  stripeConnectStatus: string | null;
};

export function AccountSettings({
  initial,
  connections,
}: {
  initial: AccountInitial;
  connections: AccountConnections;
}) {
  return (
    <div>
      <header>
        <h1 className="text-3xl font-bold text-brand-navy">Account settings</h1>
        <p className="mt-1 text-brand-navy/70">
          Manage your property details and the tools Bliss connects to.
        </p>
      </header>

      <div className="mt-4">
        <AccountInformation initial={initial} />

        <StackedSection
          title="Property management connection"
          helper="Sync rooms, rates, and bookings from your property system."
        >
          <PropertyManagementSection connections={connections} />
        </StackedSection>

        <StackedSection
          title="Payment processor connection"
          helper="Accept payments and installments, and route payouts to your bank."
        >
          <PaymentProcessorSection connections={connections} />
        </StackedSection>
      </div>
    </div>
  );
}

type Address = {
  line1: string;
  line2: string;
  city: string;
  state: string;
  zip: string;
};

// Affirm-style single-column profile section: large title, then stacked rows
// (uppercase label above a larger value, hairline under, edit affordance on the
// right). Each editable field opens in place — the row swaps to an input with
// Save/Cancel and returns to display on save. No separate page, no modal route.
function AccountInformation({ initial }: { initial: AccountInitial }) {
  const [values, setValues] = useState({
    hotelName: initial.hotelName,
    password: "1234",
    phone: initial.phone,
    addressLine1: initial.addressLine1,
    addressLine2: initial.addressLine2,
    addressCity: initial.addressCity,
    addressState: initial.addressState,
    addressZip: initial.addressZip,
  });

  function setField<K extends keyof typeof values>(key: K, value: string) {
    setValues((v) => ({ ...v, [key]: value }));
  }
  function setAddress(a: Address) {
    setValues((v) => ({
      ...v,
      addressLine1: a.line1,
      addressLine2: a.line2,
      addressCity: a.city,
      addressState: a.state,
      addressZip: a.zip,
    }));
  }

  const addressDisplay = [
    values.addressLine1,
    values.addressLine2,
    [values.addressCity, values.addressState, values.addressZip]
      .filter(Boolean)
      .join(", "),
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <StackedSection
      title="Account information"
      helper="Your property details and how guests reach you."
    >
      <FieldRow
          label="Hotel name"
          display={values.hotelName}
          renderEditor={({ close }) => (
            <SingleEditor
              initial={values.hotelName}
              autoComplete="organization"
              onSave={(v) => setField("hotelName", v)}
              close={close}
            />
          )}
        />

        <LockedRow label="Email" display={initial.email} />

        <FieldRow
          label="Password"
          display="••••••••"
          renderEditor={({ close }) => (
            <SingleEditor
              initial={values.password}
              type="password"
              autoComplete="current-password"
              onSave={(v) => setField("password", v)}
              close={close}
            />
          )}
        />

        <FieldRow
          label="Phone"
          display={values.phone}
          renderEditor={({ close }) => (
            <SingleEditor
              initial={values.phone}
              type="tel"
              autoComplete="tel"
              onSave={(v) => setField("phone", v)}
              close={close}
            />
          )}
        />

        <FieldRow
          label="Address"
          display={addressDisplay}
          last
          renderEditor={({ close }) => (
            <AddressEditor
              initial={{
                line1: values.addressLine1,
                line2: values.addressLine2,
                city: values.addressCity,
                state: values.addressState,
                zip: values.addressZip,
              }}
              onSave={setAddress}
              close={close}
            />
          )}
        />
    </StackedSection>
  );
}

// Uniform single-column section chrome shared by all three Account-settings
// sections: full-width bold title, helper line, then indented content. Matches
// the Affirm stacked layout (no two-column header).
function StackedSection({
  title,
  helper,
  children,
}: {
  title: string;
  helper: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-brand-neutral py-10">
      <h2 className="text-2xl font-bold text-brand-navy">{title}</h2>
      <p className="mt-1.5 text-sm text-brand-navy/55">{helper}</p>
      <div className="mt-7 max-w-2xl sm:pl-6">{children}</div>
    </section>
  );
}

function FieldRow({
  label,
  display,
  renderEditor,
  last = false,
}: {
  label: string;
  display: string;
  renderEditor: (helpers: { close: () => void }) => React.ReactNode;
  last?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <div className={`py-5 ${last ? "" : "border-b border-brand-neutral"}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <FieldLabel>{label}</FieldLabel>
          {!editing ? (
            <div className="mt-1 whitespace-pre-line break-words text-base text-ink">
              {display !== "" ? display : <span className="text-brand-navy/40">Not set</span>}
            </div>
          ) : null}
        </div>
        {!editing ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            aria-label={`Edit ${label.toLowerCase()}`}
            className="shrink-0 rounded-md p-1 text-brand-navy/45 transition-colors hover:text-brand-purple"
          >
            <PencilIcon className="h-4 w-4" />
          </button>
        ) : null}
      </div>
      {editing ? <div className="mt-3">{renderEditor({ close: () => setEditing(false) })}</div> : null}
    </div>
  );
}

function LockedRow({ label, display }: { label: string; display: string }) {
  return (
    <div className="border-b border-brand-neutral py-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <FieldLabel>{label}</FieldLabel>
          <div className="mt-1 break-words text-base text-ink">{display}</div>
        </div>
        <LockIcon className="h-4 w-4 shrink-0 text-brand-navy/35" />
      </div>
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-medium uppercase tracking-wide text-brand-navy/55">
      {children}
    </div>
  );
}

function SingleEditor({
  initial,
  type = "text",
  autoComplete,
  onSave,
  close,
}: {
  initial: string;
  type?: string;
  autoComplete?: string;
  onSave: (v: string) => void;
  close: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  return (
    <div>
      <Input value={draft} onChange={setDraft} type={type} autoComplete={autoComplete} autoFocus />
      <EditActions
        onSave={() => {
          onSave(draft);
          close();
        }}
        onCancel={close}
      />
    </div>
  );
}

function AddressEditor({
  initial,
  onSave,
  close,
}: {
  initial: Address;
  onSave: (a: Address) => void;
  close: () => void;
}) {
  const [draft, setDraft] = useState<Address>(initial);
  const set = (key: keyof Address, value: string) =>
    setDraft((d) => ({ ...d, [key]: value }));
  return (
    <div>
      <div className="space-y-2.5">
        <Input value={draft.line1} onChange={(v) => set("line1", v)} placeholder="Street address" autoComplete="address-line1" autoFocus />
        <Input value={draft.line2} onChange={(v) => set("line2", v)} placeholder="Suite or unit (optional)" autoComplete="address-line2" />
        <div className="grid grid-cols-[1fr_5rem_6rem] gap-2.5">
          <Input value={draft.city} onChange={(v) => set("city", v)} placeholder="City" autoComplete="address-level2" />
          <Input value={draft.state} onChange={(v) => set("state", v)} placeholder="State" maxLength={2} autoComplete="address-level1" />
          <Input value={draft.zip} onChange={(v) => set("zip", v)} placeholder="ZIP" autoComplete="postal-code" />
        </div>
      </div>
      <EditActions
        onSave={() => {
          onSave(draft);
          close();
        }}
        onCancel={close}
      />
    </div>
  );
}

function EditActions({ onSave, onCancel }: { onSave: () => void; onCancel: () => void }) {
  return (
    <div className="mt-3 flex gap-2">
      <button type="button" onClick={onSave} className="btn-primary-merchant">
        Save
      </button>
      <button type="button" onClick={onCancel} className="btn-ghost">
        Cancel
      </button>
    </div>
  );
}

function Input({
  value,
  onChange,
  type = "text",
  placeholder,
  maxLength,
  autoComplete,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  maxLength?: number;
  autoComplete?: string;
  autoFocus?: boolean;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      maxLength={maxLength}
      autoComplete={autoComplete}
      autoFocus={autoFocus}
      className="w-full rounded-md border border-brand-neutral bg-white px-3 py-2.5 text-sm text-ink placeholder:text-brand-navy/35 focus:border-brand-purple focus:outline-none focus:ring-2 focus:ring-brand-lavender/50"
    />
  );
}

function PencilIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
    </svg>
  );
}

function LockIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="5" y="11" width="14" height="9" rx="1.5" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

const MEWS = PMS_PROVIDERS.find((p) => p.name === "Mews")!;
const CLOUDBEDS = PMS_PROVIDERS.find((p) => p.name === "Cloudbeds")!;
const STRIPE = PAYMENT_PROVIDERS.find((p) => p.name === "Stripe")!;

// Property management (PMS) connection, driven by real onboarding state. Only
// Mews is connectable today; Cloudbeds is coming soon; Stripe-only properties
// have no PMS.
function PropertyManagementSection({ connections }: { connections: AccountConnections }) {
  const router = useRouter();
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { pmsType, mews } = connections;
  const mewsConnected = pmsType === "mews" && Boolean(mews?.connected);

  async function handleDisconnect() {
    setError(null);
    setDisconnecting(true);
    try {
      await disconnectMews();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not disconnect. Try again.");
      setDisconnecting(false);
    }
  }

  if (mewsConnected) {
    return (
      <div>
        <ConnectedHeader
          provider={MEWS}
          subtext={
            mews?.currency
              ? `Connected to ${mews?.enterpriseName}, charging in ${mews.currency}`
              : `Connected to ${mews?.enterpriseName}`
          }
        />
        {error ? (
          <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        ) : null}
        <div className="mt-5 flex items-center gap-4">
          <Link href="/onboarding/connect-mews" className="btn-ghost">
            Manage
          </Link>
          <button
            type="button"
            onClick={handleDisconnect}
            disabled={disconnecting}
            className="text-xs font-medium text-brand-navy/60 transition-colors hover:text-brand-purple disabled:opacity-60"
          >
            {disconnecting ? "Disconnecting" : "Disconnect"}
          </button>
        </div>
      </div>
    );
  }

  if (pmsType === "mews") {
    return (
      <ConnectPrompt
        text="Reconnect your Mews property to charge cards through Mews."
        href="/onboarding/connect-mews"
        label="Connect Mews"
      />
    );
  }

  if (pmsType === "cloudbeds") {
    return (
      <div>
        <div className="flex items-center gap-3">
          <ProviderLogo provider={CLOUDBEDS} className="h-9" />
          <span className="rounded-full bg-brand-cream px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
            Coming soon
          </span>
        </div>
        <p className="mt-3 text-sm text-brand-navy/65">
          Cloudbeds support is coming soon. Choose Mews or Stripe to finish setup now.
        </p>
        <Link href="/onboarding/pms" className="btn-ghost mt-5 inline-block">
          Choose a different PMS
        </Link>
      </div>
    );
  }

  // Stripe-only property: no PMS connected.
  return (
    <ConnectPrompt
      text="No property system connected. Connect a PMS to sync rooms, rates, and bookings."
      href="/onboarding/pms"
      label="Connect a PMS"
    />
  );
}

// Payment processor connection. For a Mews-rail property, payments run through
// Mews, so there is no separate processor. For a Stripe-rail property, this is
// the real Stripe connect flow.
function PaymentProcessorSection({ connections }: { connections: AccountConnections }) {
  const router = useRouter();
  const { pmsType, mews, stripeConnectStatus } = connections;
  const mewsConnected = pmsType === "mews" && Boolean(mews?.connected);
  const [phase, setPhase] = useState<"idle" | "connecting" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  if (mewsConnected) {
    return (
      <p className="text-sm text-brand-navy/65">
        Payments run through your Mews connection. Cards are charged in Mews, so there is no
        separate processor to connect.
      </p>
    );
  }

  const stripeConnected = stripeConnectStatus === "charges_enabled";

  if (stripeConnected) {
    return (
      <div>
        <ConnectedHeader provider={STRIPE} subtext="Payouts are set up. You can take payment plans and get paid out on arrival." />
      </div>
    );
  }

  async function handleConnectStripe() {
    setError(null);
    setPhase("connecting");
    try {
      await completeStripeConnectDemo();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not connect Stripe. Try again.");
      setPhase("error");
    }
  }

  return (
    <div>
      <div className="flex items-center gap-3">
        <ProviderLogo provider={STRIPE} className="h-8" />
      </div>
      <p className="mt-3 text-sm text-brand-navy/65">
        Connect Stripe to accept payments and installments, and route payouts to your bank.
      </p>
      {error ? (
        <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}
      <button
        type="button"
        onClick={handleConnectStripe}
        disabled={phase === "connecting"}
        className="btn-primary-merchant mt-5"
      >
        {phase === "connecting" ? (
          <span className="flex items-center gap-2">
            <Spinner className="h-4 w-4" />
            Connecting
          </span>
        ) : (
          "Connect Stripe"
        )}
      </button>
    </div>
  );
}

// Shared: connected header with a logo, a "Connected" tag, and a subtext line.
function ConnectedHeader({ provider, subtext }: { provider: { name: string; logo: string }; subtext: string }) {
  return (
    <div className="flex items-center gap-4">
      <ProviderLogo provider={provider} className="h-10" />
      <div>
        <div className="flex items-center gap-2 text-lg font-semibold text-brand-navy">
          {provider.name}
          <span className="inline-flex items-center gap-1 text-brand-purple">
            <CheckIcon className="h-3.5 w-3.5" />
            Connected
          </span>
        </div>
        <div className="mt-0.5 text-sm text-brand-navy/65">{subtext}</div>
      </div>
    </div>
  );
}

// Shared: a prompt line plus a primary link-button for an unconnected tool.
function ConnectPrompt({ text, href, label }: { text: string; href: string; label: string }) {
  return (
    <div>
      <p className="text-sm text-brand-navy/65">{text}</p>
      <Link href={href} className="btn-primary-merchant mt-5 inline-block">
        {label}
      </Link>
    </div>
  );
}
