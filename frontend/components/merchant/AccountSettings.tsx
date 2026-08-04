"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  CheckIcon,
  PAYMENT_PROVIDERS,
  PMS_PROVIDERS,
  ProviderLogo,
  Spinner,
} from "./ConnectionsContext";
import {
  cloudbedsOAuthStartUrl,
  completeStripeConnectStandardDemo,
  disconnectMews,
  fetchStripeConnectStatus,
  startStripeConnect,
  type OnboardingCloudbeds,
  type OnboardingMews,
  type OnboardingStateWire,
  type PmsType,
  type StripeConnectStatus,
} from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { PageHeader, Panel } from "@/components/ui/primitives";

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
  cloudbeds: OnboardingCloudbeds | null;
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
    <div className="flex max-w-[980px] flex-col">
      <PageHeader
        title="Account settings"
        subtitle="Manage your property details and the tools Bliss connects to."
      />

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
    password: "",
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
      dense
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
  dense = false,
}: {
  title: string;
  helper: string;
  children: React.ReactNode;
  /** Account information holds ruled rows, so its panel takes tighter padding. */
  dense?: boolean;
}) {
  return (
    <section className="mb-7 flex flex-col">
      <div className="mb-5 flex flex-col gap-2">
        <h2 className="text-2xl font-medium tracking-[-0.02em] text-ink-900">
          {title}
        </h2>
        <p className="text-[17px] text-ink-400">{helper}</p>
      </div>
      <Panel
        variant="filled"
        className={dense ? "px-7 py-1.5" : "px-7 py-[30px]"}
      >
        {children}
      </Panel>
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
    <div
      className={`flex flex-col gap-2 py-6 ${last ? "" : "border-b border-sand-100"}`}
    >
      <FieldLabel>{label}</FieldLabel>
      {!editing ? (
        // The edit control sits beside its value, not at the row's far edge.
        <div className="flex items-baseline gap-[18px]">
          <div className="min-w-0 whitespace-pre-line break-words text-xl tracking-[-0.012em] text-ink-900">
            {display !== "" ? display : <span className="text-ink-300">Not set</span>}
          </div>
          <button
            type="button"
            onClick={() => setEditing(true)}
            aria-label={`Edit ${label.toLowerCase()}`}
            className="flex-none text-base font-medium text-brand-violet transition-colors hover:text-brand-violet-deep"
          >
            Edit
          </button>
        </div>
      ) : (
        <div>{renderEditor({ close: () => setEditing(false) })}</div>
      )}
    </div>
  );
}

function LockedRow({ label, display }: { label: string; display: string }) {
  return (
    <div className="flex flex-col gap-2 border-b border-sand-100 py-6">
      <FieldLabel>{label}</FieldLabel>
      <div className="flex items-baseline gap-[18px]">
        <div className="min-w-0 break-words text-xl tracking-[-0.012em] text-ink-900">
          {display}
        </div>
        <span className="flex flex-none items-center gap-[7px] text-[15px] text-ink-400">
          <LockIcon className="h-3.5 w-3.5" />
          Locked
        </span>
      </div>
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs uppercase tracking-[0.08em] text-ink-400">
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
      <Button type="button" onClick={onSave} variant="merchant">
        Save
      </Button>
      <Button type="button" onClick={onCancel} variant="ghost">
        Cancel
      </Button>
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
      className="w-full rounded-md border border-sand-200 bg-white px-3 py-2.5 text-sm text-ink-900 placeholder:text-ink-400 focus:border-brand-violet focus:outline-none focus:shadow-[0_0_0_4px_rgba(90,27,181,0.10)]"
    />
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
  const { pmsType, mews, cloudbeds } = connections;
  const mewsConnected = pmsType === "mews" && Boolean(mews?.connected);
  const cloudbedsConnected = pmsType === "cloudbeds" && Boolean(cloudbeds?.connected);

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
          <Button href="/onboarding/connect-mews" variant="ghost">
            Manage
          </Button>
          <button
            type="button"
            onClick={handleDisconnect}
            disabled={disconnecting}
            className="text-xs font-medium text-ink-400 transition-colors hover:text-brand-violet disabled:opacity-60"
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

  if (cloudbedsConnected) {
    return (
      <div>
        <ConnectedHeader
          provider={CLOUDBEDS}
          subtext={
            cloudbeds?.currency
              ? `Connected to ${cloudbeds?.propertyName ?? "your property"}, charging in ${cloudbeds.currency}`
              : `Connected to ${cloudbeds?.propertyName ?? "your property"}`
          }
        />
        <div className="mt-5 flex items-center gap-4">
          {/* Reconnect re-runs OAuth: a real navigation, not a fetch. */}
          <a href={cloudbedsOAuthStartUrl()} className="btn-ghost">
            Reconnect
          </a>
        </div>
      </div>
    );
  }

  if (pmsType === "cloudbeds") {
    return (
      <div>
        <p className="text-sm text-ink-500">
          Authorize Bliss in your Cloudbeds account to charge cards through Cloudbeds.
        </p>
        {/* OAuth start: full-page navigation to the backend endpoint. */}
        <a href={cloudbedsOAuthStartUrl()} className="btn-primary-merchant mt-5 inline-block">
          Connect Cloudbeds
        </a>
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
  const { pmsType, mews } = connections;
  const mewsConnected = pmsType === "mews" && Boolean(mews?.connected);
  const [phase, setPhase] = useState<"idle" | "connecting" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  // Live Connect Standard status. The session's stripeConnectStatus reflects
  // the older Express columns on the merchant row, which the per-property
  // Standard flow never writes, so read the connection from its own endpoint.
  // Mounting after Stripe returns to /dashboard is what refreshes this.
  const [connect, setConnect] = useState<StripeConnectStatus | null>(null);

  useEffect(() => {
    if (mewsConnected) return;
    let active = true;
    fetchStripeConnectStatus()
      .then((status) => {
        if (active) setConnect(status);
      })
      .catch(() => {
        // Leave the section in its not-connected state; the button still works.
      });
    return () => {
      active = false;
    };
  }, [mewsConnected]);

  if (mewsConnected) {
    return (
      <p className="text-sm text-ink-500">
        Payments run through your Mews connection. Cards are charged in Mews, so there is no
        separate processor to connect.
      </p>
    );
  }

  if (connect?.chargesEnabled) {
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
      const link = await startStripeConnect();
      if ("error" in link) {
        // No Stripe key on the backend, so there is no hosted flow to send
        // them to. Mark the property connected the way the demo path does.
        setConnect(await completeStripeConnectStandardDemo());
        setPhase("idle");
        router.refresh();
        return;
      }
      window.location.href = link.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not connect Stripe. Try again.");
      setPhase("error");
    }
  }

  const resuming = connect?.status === "in_progress" || connect?.status === "restricted";

  return (
    <div>
      <div className="flex items-center gap-3">
        <ProviderLogo provider={STRIPE} className="h-8" />
      </div>
      <p className="mt-3 text-sm text-ink-500">
        {resuming
          ? "Your Stripe onboarding is not finished. Pick up where you left off to start taking payments."
          : "Connect Stripe to accept payments and installments, and route payouts to your bank."}
      </p>
      {error ? (
        <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}
      <Button
        type="button"
        onClick={handleConnectStripe}
        disabled={phase === "connecting"}
        variant="merchant"
        className="mt-5"
      >
        {phase === "connecting" ? (
          <span className="flex items-center gap-2">
            <Spinner className="h-4 w-4" />
            Redirecting to Stripe
          </span>
        ) : resuming ? (
          "Continue Stripe setup"
        ) : (
          "Connect Stripe"
        )}
      </Button>
    </div>
  );
}

// Shared: connected header with a logo, a "Connected" tag, and a subtext line.
function ConnectedHeader({ provider, subtext }: { provider: { name: string; logo: string }; subtext: string }) {
  return (
    <div className="flex items-center gap-4">
      <ProviderLogo provider={provider} className="h-10" />
      <div>
        <div className="flex items-center gap-2 text-lg font-semibold text-ink-900">
          {provider.name}
          <span className="inline-flex items-center gap-1 text-brand-violet">
            <CheckIcon className="h-3.5 w-3.5" />
            Connected
          </span>
        </div>
        <div className="mt-0.5 text-sm text-ink-500">{subtext}</div>
      </div>
    </div>
  );
}

// Shared: a prompt line plus a primary link-button for an unconnected tool.
function ConnectPrompt({ text, href, label }: { text: string; href: string; label: string }) {
  return (
    <div>
      <p className="text-sm text-ink-500">{text}</p>
      <Button href={href} variant="merchant" className="mt-5 inline-block">
        {label}
      </Button>
    </div>
  );
}
