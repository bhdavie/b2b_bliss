"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
} from "react";

// Shared, session-persistent connection state for the merchant area. All
// connections are SIMULATED for the demo (no OAuth / processor / PMS handshake):
// selecting a provider + Connect runs a brief spinner, then flips to connected.
// State lives here (provider mounted in the authenticated layout) and is mirrored
// to localStorage so Home's at-a-glance status and Account settings agree and
// survive navigation + reload. Logos are vendored under /public/logos.

export type Provider = { name: string; logo: string };

export const PAYMENT_PROVIDERS: Provider[] = [
  { name: "Stripe", logo: "/logos/stripe.svg" },
  { name: "Adyen", logo: "/logos/adyen.svg" },
  { name: "Shift4", logo: "/logos/shift4.png" },
];

export const PMS_PROVIDERS: Provider[] = [
  { name: "Mews", logo: "/logos/mews.png" },
  { name: "Apaleo", logo: "/logos/apaleo.png" },
  { name: "Cloudbeds", logo: "/logos/cloudbeds.png" },
];

export type ConnState = "disconnected" | "connecting" | "connected";
export type ConnKind = "payments" | "pms";

export type Connection = {
  kind: ConnKind;
  providers: Provider[];
  selected: Provider;
  state: ConnState;
  account: string;
  select: (p: Provider) => void;
  connect: () => void;
  disconnect: () => void;
};

type Ctx = { payments: Connection; pms: Connection };
const ConnectionsCtx = createContext<Ctx | null>(null);

const SIMULATED_CONNECT_MS = 1200;
const STORAGE_KEY = "bliss.connections.v1";
const ACCOUNT_LABEL: Record<ConnKind, string> = {
  payments: "Acct ••• 4242",
  pms: "demo@marbrookhouse.com",
};

type Internal = { selectedName: string; state: ConnState };
type Setter = React.Dispatch<React.SetStateAction<Internal>>;

export function ConnectionsProvider({ children }: { children: React.ReactNode }) {
  const [payments, setPayments] = useState<Internal>({
    selectedName: PAYMENT_PROVIDERS[0]!.name,
    state: "disconnected",
  });
  const [pms, setPms] = useState<Internal>({
    selectedName: PMS_PROVIDERS[0]!.name,
    state: "disconnected",
  });

  // Hydrate from localStorage after mount (server renders the default, then the
  // client restores any prior session — avoids a hydration mismatch).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const p = JSON.parse(raw) as { payments?: Internal; pms?: Internal };
      if (p.payments) {
        setPayments({
          selectedName: p.payments.selectedName,
          state: p.payments.state === "connected" ? "connected" : "disconnected",
        });
      }
      if (p.pms) {
        setPms({
          selectedName: p.pms.selectedName,
          state: p.pms.state === "connected" ? "connected" : "disconnected",
        });
      }
    } catch {
      // ignore malformed/blocked storage
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ payments, pms }));
    } catch {
      // ignore blocked storage
    }
  }, [payments, pms]);

  function build(
    kind: ConnKind,
    internal: Internal,
    setInternal: Setter,
    providers: Provider[],
  ): Connection {
    return {
      kind,
      providers,
      selected:
        providers.find((p) => p.name === internal.selectedName) ?? providers[0]!,
      state: internal.state,
      account: ACCOUNT_LABEL[kind],
      select: (p) =>
        setInternal((s) =>
          s.state === "connecting" ? s : { ...s, selectedName: p.name },
        ),
      connect: () => {
        setInternal((s) => ({ ...s, state: "connecting" }));
        setTimeout(
          () => setInternal((s) => ({ ...s, state: "connected" })),
          SIMULATED_CONNECT_MS,
        );
      },
      disconnect: () => setInternal((s) => ({ ...s, state: "disconnected" })),
    };
  }

  const value: Ctx = {
    payments: build("payments", payments, setPayments, PAYMENT_PROVIDERS),
    pms: build("pms", pms, setPms, PMS_PROVIDERS),
  };

  return <ConnectionsCtx.Provider value={value}>{children}</ConnectionsCtx.Provider>;
}

export function useConnections(): Ctx {
  const ctx = useContext(ConnectionsCtx);
  if (!ctx) {
    throw new Error("useConnections must be used within ConnectionsProvider");
  }
  return ctx;
}

// Real brand mark, sitting inline at a fixed height with no tile/box behind it.
// Falls back to the provider name (plain inline text) only if the asset fails.
export function ProviderLogo({
  provider,
  className = "h-6",
}: {
  provider: Provider;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span className="text-sm font-semibold text-brand-navy">{provider.name}</span>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      src={provider.logo}
      alt={provider.name}
      loading="lazy"
      onError={() => setFailed(true)}
      className={`${className} object-contain`}
    />
  );
}

export function CheckIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0l-3.5-3.5a1 1 0 1 1 1.4-1.4l2.8 2.8 6.8-6.8a1 1 0 0 1 1.4 0Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4Z" />
    </svg>
  );
}
