"use client";

import { useState } from "react";
import {
  CheckIcon,
  ProviderLogo,
  Spinner,
  useConnections,
  type Connection,
} from "./ConnectionsContext";

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

export function AccountSettings({ initial }: { initial: AccountInitial }) {
  const { payments, pms } = useConnections();

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
          <ConnectionPanel
            conn={pms}
            prompt="Connect your property system to sync rooms, rates, and bookings."
          />
        </StackedSection>

        <StackedSection
          title="Payment processor connection"
          helper="Accept payments and installments, and route payouts to your bank."
        >
          <ConnectionPanel
            conn={payments}
            prompt="Connect a processor to start accepting payments and installments."
          />
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

// Connected vs disconnected connection row. Logos sit inline at a fixed height,
// no box. Disconnected uses underline-selection for the picker.
function ConnectionPanel({ conn, prompt }: { conn: Connection; prompt: string }) {
  const connecting = conn.state === "connecting";

  if (conn.state === "connected") {
    return (
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <ProviderLogo provider={conn.selected} className="h-10" />
          <div>
            <div className="flex items-center gap-2 text-lg font-semibold text-brand-navy">
              {conn.selected.name}
              <span className="inline-flex items-center gap-1 text-brand-purple">
                <CheckIcon className="h-3.5 w-3.5" />
                Connected
              </span>
            </div>
            <div className="mt-0.5 text-sm text-brand-navy/65">
              Connected as {conn.account}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <button type="button" className="btn-ghost">
            Manage
          </button>
          <button
            type="button"
            onClick={conn.disconnect}
            className="text-xs font-medium text-brand-navy/60 transition-colors hover:text-brand-purple"
          >
            Disconnect
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <p className="text-sm text-brand-navy/65">{prompt}</p>
      <div className="mt-4 flex flex-col gap-1">
        {conn.providers.map((p) => {
          const isSelected = conn.selected.name === p.name;
          return (
            <button
              key={p.name}
              type="button"
              onClick={() => conn.select(p)}
              disabled={connecting}
              aria-pressed={isSelected}
              className={`flex w-full items-center gap-4 border-b-2 py-3 text-left transition ${
                isSelected
                  ? "border-brand-lavender opacity-100"
                  : "border-transparent opacity-45 hover:opacity-100"
              } ${connecting ? "cursor-not-allowed" : ""}`}
            >
              <ProviderLogo provider={p} className="h-12 w-32 shrink-0 object-left" />
              <span className="text-lg font-semibold text-brand-navy">{p.name}</span>
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={conn.connect}
        disabled={connecting}
        className="btn-primary-merchant mt-6"
      >
        {connecting ? (
          <span className="flex items-center gap-2">
            <Spinner className="h-4 w-4" />
            Connecting…
          </span>
        ) : (
          `Connect ${conn.selected.name}`
        )}
      </button>
    </div>
  );
}
