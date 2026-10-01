"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  CheckIcon,
  PMS_PROVIDERS,
  ProviderLogo,
} from "./ConnectionsContext";
import {
  cloudbedsOAuthStartUrl,
  disconnectMews,
  setPropertyLocale,
  type OnboardingCloudbeds,
  type OnboardingMews,
  type OnboardingStateWire,
  type PmsType,
} from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Panel, SectionHeading } from "@/components/ui/primitives";

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

/** The property's currency, zone and locale from /me, and where they come from. */
export type AccountPropertyLocale = {
  currency: string | null;
  timeZone: string | null;
  locale: string | null;
  pmsType: PmsType;
  /**
   * Whether Bliss has Stripe configured, for a Stripe property: then Stripe is
   * the source and the values are read-only. Null when not known.
   */
  stripeConfigured: boolean | null;
};

export function AccountSettings({
  initial,
  connections,
  propertyLocale,
}: {
  initial: AccountInitial;
  connections: AccountConnections;
  propertyLocale: AccountPropertyLocale;
}) {
  return (
    <div className="flex flex-col">
      <AccountInformation initial={initial} />

      <StackedSection
        id="currency"
        title="Currency and time zone"
        helper="Bookings are priced in this currency, and payment dates follow this time zone."
      >
        <PropertyLocaleSection initial={propertyLocale} />
      </StackedSection>

      <StackedSection
        title="Property management connection"
        helper="Sync rooms, rates, and bookings from your property system."
      >
        <PropertyManagementSection connections={connections} />
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
    <StackedSection title="Account information" dense>
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

// Uniform single-column section chrome shared by the Account-settings
// sections: one card, opening with its own heading and optional helper line,
// then the section's content. Single column, no two-column header.
function StackedSection({
  id,
  title,
  helper,
  children,
  dense = false,
}: {
  /** Anchor so other screens can link straight to this section. */
  id?: string;
  title: string;
  /**
   * Optional. "Account information" dropped its helper because the helper
   * restated the title: "Your property details and how guests reach you" said
   * the same thing as the heading, and its second clause was not even true —
   * the fields under it are the login email and the property's own address,
   * not a contact route for guests. The connection section keeps its helper,
   * which explains what connecting a PMS actually does.
   */
  helper?: string;
  children: React.ReactNode;
  /** Account information holds ruled rows, so its panel takes tighter padding. */
  dense?: boolean;
}) {
  // Title and helper are INSIDE the panel now. They were a 24px h2 and a 17px
  // line sitting on the page ground directly above the card they name, which
  // made /dashboard the loosest screen in the app: four lines of content on the
  // sand before the first surface. Nothing else on this page reads as belonging
  // to the ground, so neither should its section heads.
  //
  // `dense` no longer means "no vertical padding": the panel has to open with
  // its own heading now, so the tier is a tighter body padding under a normal
  // head rather than a panel that starts flush with a ruled row.
  return (
    <section id={id} className="mb-3 flex scroll-mt-6 flex-col">
      <Panel variant="filled" className="p-5">
        <div className={`flex flex-col gap-1 ${helper ? "mb-4" : "mb-4"}`}>
          <SectionHeading>{title}</SectionHeading>
          {helper ? <p className="text-[14px] text-ink-500">{helper}</p> : null}
        </div>
        <div className={dense ? "-mb-[18px]" : ""}>{children}</div>
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
      className={`flex flex-col gap-2 py-4 first:pt-0 ${last ? "" : "border-b border-sand-100"}`}
    >
      <FieldLabel>{label}</FieldLabel>
      {!editing ? (
        // The edit control sits beside its value, not at the row's far edge.
        <div className="flex items-baseline gap-[18px]">
          <div className="min-w-0 whitespace-pre-line break-words text-[14px] text-ink-900">
            {display !== "" ? display : <span className="text-ink-300">Not set</span>}
          </div>
          <button
            type="button"
            onClick={() => setEditing(true)}
            aria-label={`Edit ${label.toLowerCase()}`}
            className="flex-none text-[14px] text-brand-violet transition-colors hover:text-brand-violet-deep"
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
    <div className="flex flex-col gap-2 border-b border-sand-100 py-4">
      <FieldLabel>{label}</FieldLabel>
      <div className="flex items-baseline gap-[18px]">
        <div className="min-w-0 break-words text-[14px] text-ink-900">
          {display}
        </div>
        <span className="flex flex-none items-center gap-[7px] text-[13px] text-ink-500">
          <LockIcon className="h-3.5 w-3.5" />
          Locked
        </span>
      </div>
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[12px] uppercase tracking-[0.08em] text-ink-500">
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
      className="w-full rounded-md border border-sand-200 bg-white px-3 py-2.5 text-[13px] text-ink-900 placeholder:text-ink-500 focus:border-brand-violet focus:outline-none focus:shadow-focus-ring"
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

// Common ISO 4217 codes offered when a property sets its currency by hand.
const CURRENCY_CODES = [
  "USD", "EUR", "GBP", "CAD", "AUD", "NZD", "JPY", "CHF", "SEK",
  "NOK", "DKK", "MXN", "BRL", "SGD", "HKD", "AED", "ZAR", "INR",
] as const;

// Locales offered for formatting amounts and dates. Optional: none formats in
// plain English.
const LOCALE_TAGS = [
  "en-US", "en-GB", "en-AU", "en-CA", "fr-FR", "de-DE",
  "es-ES", "it-IT", "nl-NL", "pt-BR", "ja-JP",
] as const;

function displayName(type: "currency" | "language", code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type }).of(code) ?? code;
  } catch {
    return code;
  }
}

function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function supportedTimeZones(): string[] {
  try {
    const intl = Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] };
    const zones = intl.supportedValuesOf?.("timeZone");
    if (zones && zones.length > 0) return zones.includes("UTC") ? zones : ["UTC", ...zones];
  } catch {
    /* fall through */
  }
  return ["UTC"];
}

// The property's currency, time zone and locale. A property with a connected
// system (Mews, Cloudbeds, or Stripe when Bliss has it configured) reads them
// from that system, so they show read-only here. A property with nothing to
// read them from sets them itself.
function PropertyLocaleSection({ initial }: { initial: AccountPropertyLocale }) {
  const router = useRouter();
  const sourced =
    initial.pmsType === "mews" ||
    initial.pmsType === "cloudbeds" ||
    (initial.pmsType === "stripe" && initial.stripeConfigured === true);
  const source =
    initial.pmsType === "mews"
      ? "Mews"
      : initial.pmsType === "cloudbeds"
        ? "Cloudbeds"
        : "Stripe";

  const zones = useMemo(supportedTimeZones, []);
  const [currency, setCurrency] = useState(initial.currency ?? "");
  // The browser's zone is only the first suggestion; nothing is saved until
  // the property saves.
  const [timeZone, setTimeZone] = useState(initial.timeZone ?? browserTimeZone());
  const [locale, setLocale] = useState(initial.locale ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currencyOptions = useMemo(() => {
    const codes: string[] = [...CURRENCY_CODES];
    if (initial.currency && !codes.includes(initial.currency)) codes.unshift(initial.currency);
    return codes;
  }, [initial.currency]);
  const zoneOptions = useMemo(
    () => (zones.includes(timeZone) ? zones : [timeZone, ...zones]),
    [zones, timeZone],
  );

  if (sourced) {
    return (
      <div>
        <ReadOnlyLine
          label="Currency"
          value={
            initial.currency
              ? `${initial.currency} · ${displayName("currency", initial.currency)}`
              : ""
          }
        />
        <ReadOnlyLine label="Time zone" value={initial.timeZone ?? ""} />
        <ReadOnlyLine
          label="Locale"
          value={initial.locale ? `${initial.locale} · ${displayName("language", initial.locale)}` : ""}
          last
        />
        <p className="mt-4 text-[13px] text-ink-500">
          These come from your {source} connection.
          {initial.currency ? "" : ` They fill in once ${source} reports them.`}
        </p>
      </div>
    );
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!currency) {
      setError("Choose a currency.");
      return;
    }
    if (!timeZone) {
      setError("Choose a time zone.");
      return;
    }
    setError(null);
    setSaved(false);
    setSaving(true);
    const res = await setPropertyLocale({
      currency,
      timeZone,
      locale: locale || null,
    });
    setSaving(false);
    if (res.ok) {
      setSaved(true);
      router.refresh();
      return;
    }
    setError(
      res.error === "property_locale_sourced"
        ? "Your currency and time zone come from your connected system, so they can't be changed here."
        : res.message,
    );
  }

  return (
    <form onSubmit={handleSave} className="flex flex-col gap-4">
      {initial.currency === null ? (
        <p className="text-[13px] text-ink-500">
          Your property has no currency yet. Set one to start creating bookings.
        </p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block">
          <FieldLabel>Currency</FieldLabel>
          <select
            value={currency}
            onChange={(e) => {
              setCurrency(e.target.value);
              setSaved(false);
            }}
            className="input mt-1.5"
            required
          >
            <option value="" disabled>
              Choose a currency
            </option>
            {currencyOptions.map((code) => (
              <option key={code} value={code}>
                {code} · {displayName("currency", code)}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <FieldLabel>Time zone</FieldLabel>
          <select
            value={timeZone}
            onChange={(e) => {
              setTimeZone(e.target.value);
              setSaved(false);
            }}
            className="input mt-1.5"
            required
          >
            {zoneOptions.map((z) => (
              <option key={z} value={z}>
                {z.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <FieldLabel>Locale (optional)</FieldLabel>
          <select
            value={locale}
            onChange={(e) => {
              setLocale(e.target.value);
              setSaved(false);
            }}
            className="input mt-1.5"
          >
            <option value="">Plain English</option>
            {(initial.locale && !(LOCALE_TAGS as readonly string[]).includes(initial.locale)
              ? [initial.locale, ...LOCALE_TAGS]
              : [...LOCALE_TAGS]
            ).map((tag) => (
              <option key={tag} value={tag}>
                {tag} · {displayName("language", tag)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-[13px] text-red-700" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex items-center gap-4">
        <Button type="submit" variant="merchant" disabled={saving}>
          {saving ? "Saving" : "Save"}
        </Button>
        {saved ? <span className="text-[13px] text-ink-500">Saved</span> : null}
      </div>
    </form>
  );
}

function ReadOnlyLine({ label, value, last = false }: { label: string; value: string; last?: boolean }) {
  return (
    <div className={`flex flex-col gap-2 py-4 first:pt-0 ${last ? "" : "border-b border-sand-100"}`}>
      <FieldLabel>{label}</FieldLabel>
      <div className="text-[14px] text-ink-900">
        {value !== "" ? value : <span className="text-ink-300">Not set</span>}
      </div>
    </div>
  );
}

const MEWS = PMS_PROVIDERS.find((p) => p.name === "Mews")!;
const CLOUDBEDS = PMS_PROVIDERS.find((p) => p.name === "Cloudbeds")!;

// Property management (PMS) connection, driven by real onboarding state. Mews
// and Cloudbeds are the two connectable rails; a property that has not chosen
// one yet is prompted to.
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
          <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-[13px] text-red-700">{error}</p>
        ) : null}
        <div className="mt-5 flex items-center gap-4">
          <Button href="/onboarding/connect-mews" variant="ghost">
            Manage
          </Button>
          <button
            type="button"
            onClick={handleDisconnect}
            disabled={disconnecting}
            className="text-[13px] text-ink-500 transition-colors hover:text-brand-violet disabled:opacity-60"
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
        <p className="text-[13px] text-ink-500">
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

// The Payment processor connection section was removed with the rest of the
// payment-processor surface: a property connects its property system, and that
// system executes the charge. Nothing here connected a second time.

// Shared: connected header with a logo, a "Connected" tag, and a subtext line.
function ConnectedHeader({ provider, subtext }: { provider: { name: string; logo: string }; subtext: string }) {
  return (
    <div className="flex items-center gap-4">
      <ProviderLogo provider={provider} className="h-10" />
      <div>
        <div className="flex items-center gap-2 text-[14px] font-semibold text-ink-900">
          {provider.name}
          <span className="inline-flex items-center gap-1 text-brand-violet">
            <CheckIcon className="h-3.5 w-3.5" />
            Connected
          </span>
        </div>
        <div className="mt-0.5 text-[13px] text-ink-500">{subtext}</div>
      </div>
    </div>
  );
}

// Shared: a prompt line plus a primary link-button for an unconnected tool.
function ConnectPrompt({ text, href, label }: { text: string; href: string; label: string }) {
  return (
    <div>
      <p className="text-[13px] text-ink-500">{text}</p>
      <Button href={href} variant="merchant" className="mt-5 inline-block">
        {label}
      </Button>
    </div>
  );
}
