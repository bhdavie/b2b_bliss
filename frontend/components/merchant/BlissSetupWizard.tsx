"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  createStripeAccountLink,
  fetchBlissSettings,
  resyncMews,
  switchBlissOn,
  updateBlissSettings,
  type BlissSetting,
  type BlissSettingsView,
} from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/primitives";
import { MewsBookingSetup } from "./MewsBookingSetup";
import { MewsInstallGuide } from "./MewsInstallGuide";

// The Bliss setup screens after Mews is connected (configurable-property spec,
// section 10.1). Bliss reads the setup from Mews, so the hotel reviews rather
// than types: its Bliss rates, how it gets paid, the defaults, the pop-up, and
// then "Switch Bliss on", which finishes onboarding.

const STEPS = [
  "Turn on Bliss",
  "Your Bliss rates",
  "How you get paid",
  "Everything else is set",
  "Add Bliss to your booking page",
] as const;

function setting(view: BlissSettingsView, key: string): BlissSetting | undefined {
  return view.settings.find((s) => s.key === key);
}

export function BlissSetupWizard({
  initial,
  slug,
  startStep = 0,
}: {
  initial: BlissSettingsView;
  slug: string;
  startStep?: number;
}) {
  const router = useRouter();
  const [step, setStep] = useState(Math.min(Math.max(startStep, 0), STEPS.length - 1));
  const [view, setView] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const rates = view.settings.filter((s) => s.key.startsWith("bookingType:"));
  // Chosen rates, from the connection: continuing doesn't wait on the sync
  // that reads their terms, which can fail while Mews is busy.
  const chosen = setting(view, "blissRates");
  const hasRates =
    chosen != null && typeof chosen.value === "object" && chosen.value !== null
      ? Object.keys(chosen.value).length > 0
      : rates.length > 0;

  async function refresh(sync: boolean) {
    setError(null);
    if (sync) {
      const synced = await resyncMews();
      if (!synced.ok) setError(synced.message);
    }
    try {
      setView(await fetchBlissSettings());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read your settings.");
    }
  }

  async function finish() {
    setBusy(true);
    setError(null);
    const result = await switchBlissOn();
    if (!result.ok) {
      setBusy(false);
      setError(result.message);
      return;
    }
    router.push("/home");
  }

  return (
    <Panel radius="panel" variant="filled" className="gap-6 px-8 pb-8 pt-[30px]">
      <div className="flex flex-col gap-1">
        <p className="text-[13px] text-ink-500">
          Step {step + 1} of {STEPS.length}
        </p>
        <h2 className="text-2xl font-medium tracking-[-0.02em] text-ink-900">{STEPS[step]}</h2>
      </div>

      {step === 0 ? (
        <p className="max-w-[640px] text-[17px] leading-[1.55] text-ink-500">
          Bliss lets your guests pay for their stay over time, interest free. We&apos;ve read your
          setup from Mews, so there&apos;s nothing to type. Review it on the next screens and switch
          Bliss on when you&apos;re ready.
        </p>
      ) : null}

      {step === 1 ? (
        <div className="flex flex-col gap-6">
          <p className="max-w-[640px] text-[15px] leading-[1.5] text-ink-500">
            Guests choose a payment plan by booking one of these rates. Their cancellation terms come
            from Mews, so if you change them there, Bliss follows.
          </p>
          <MewsBookingSetup onSaved={() => void refresh(true)} />
          {rates.length > 0 ? (
            <ul className="flex flex-col divide-y divide-sand-200 border-t border-sand-200">
              {rates.map((r) => (
                <li key={r.key} className="flex flex-col gap-[2px] py-[10px]">
                  <span className="text-[14px] text-ink-900">{r.label.replace(/^Booking type for /, "")}</span>
                  <span className="text-[13px] text-ink-500">{r.display}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {step === 2 ? <PayoutChoice view={view} onChange={setView} /> : null}

      {step === 3 ? <DefaultsList view={view} /> : null}

      {step === 4 ? (
        <div className="flex flex-col gap-4">
          <p className="max-w-[640px] text-[15px] leading-[1.5] text-ink-500">
            Add the Bliss pop-up to your Mews booking engine so guests can choose a plan while they
            book. You can do this now or later from Install.
          </p>
          <MewsInstallGuide slug={slug} />
        </div>
      ) : null}

      {error ? <p className="rounded-xl bg-red-50 px-4 py-3 text-base text-danger">{error}</p> : null}

      <div className="flex flex-wrap items-center gap-4 border-t border-sand-100 pt-6">
        {step < STEPS.length - 1 ? (
          <Button
            type="button"
            variant="merchant"
            disabled={step === 1 && !hasRates}
            onClick={() => {
              setError(null);
              setStep(step + 1);
            }}
          >
            Continue
          </Button>
        ) : (
          <Button type="button" variant="merchant" disabled={busy} onClick={finish}>
            {busy ? "Switching Bliss on" : "Switch Bliss on"}
          </Button>
        )}
        {step > 0 ? (
          <Button type="button" variant="ghost" disabled={busy} onClick={() => setStep(step - 1)}>
            Back
          </Button>
        ) : null}
        {step === 1 && !hasRates ? (
          <span className="text-[13px] text-ink-500">Save a Bliss rate to continue.</span>
        ) : null}
      </div>
    </Panel>
  );
}

/** Screen 3: pay as you go, or hold until it's yours. */
function PayoutChoice({
  view,
  onChange,
}: {
  view: BlissSettingsView;
  onChange: (view: BlissSettingsView) => void;
}) {
  const payout = setting(view, "payoutMode");
  const holdOption = payout?.options?.find((o) => o.value === "hold");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [needsStripe, setNeedsStripe] = useState(false);

  async function choose(mode: string) {
    setSaving(true);
    setMessage(null);
    setNeedsStripe(false);
    const result = await updateBlissSettings({ payoutMode: mode });
    setSaving(false);
    if (result.ok) {
      onChange(result.view);
      return;
    }
    setMessage(result.message);
    setNeedsStripe(result.error === "express_onboarding_required");
  }

  async function setUpStripe() {
    const link = await createStripeAccountLink();
    if ("url" in link) window.location.href = link.url;
    else setMessage("Stripe isn't available right now. Please try again later.");
  }

  const options = [
    {
      value: "pay_as_you_go",
      title: "Pay as you go (recommended to start)",
      body: "Each payment goes straight to you through Mews Payments, like any other card payment. Nothing to set up.",
      available: true,
      note: null as string | null,
    },
    {
      value: "hold",
      title: "Hold until it's yours",
      body:
        "Bliss holds each payment safely with Stripe until it can no longer be refunded, then sends it to your " +
        "bank by ACH. You never hold money you might have to give back. Needs a short Stripe setup. We'll send " +
        "you each booking's money when its free cancellation ends, or as each payment clears for non-refundable rates.",
      available: holdOption?.available ?? false,
      note: holdOption?.note ?? null,
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      {options.map((o) => {
        const selected = payout?.value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            disabled={saving || !o.available || selected}
            onClick={() => choose(o.value)}
            aria-pressed={selected}
            className={`flex flex-col gap-1 rounded-card border p-4 text-left transition-colors ${
              selected ? "border-brand-violet bg-brand-lavender/20" : "border-sand-200 bg-white"
            } ${o.available ? "" : "opacity-60"}`}
          >
            <span className="text-[15px] font-medium text-ink-900">
              {o.title}
              {o.note ? <span className="ml-2 text-[13px] font-normal text-ink-500">{o.note}</span> : null}
            </span>
            <span className="text-[14px] leading-[1.5] text-ink-500">{o.body}</span>
          </button>
        );
      })}
      {message ? <p className="text-[14px] text-danger">{message}</p> : null}
      {needsStripe ? (
        <div>
          <Button type="button" variant="ghost" onClick={setUpStripe}>
            Set up Stripe payouts
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** Screen 4: the defaults in plain words, each with a way to change it. */
function DefaultsList({ view }: { view: BlissSettingsView }) {
  const shown = view.settings.filter(
    (s) => (s.group === "plans" || s.group === "fees") && s.key !== "deposit",
  );
  return (
    <div className="flex flex-col gap-3">
      <p className="max-w-[640px] text-[15px] leading-[1.5] text-ink-500">
        These start with sensible defaults, so there&apos;s nothing you need to change. You can
        change any of them later in Settings.
      </p>
      <ul className="flex flex-col divide-y divide-sand-200 border-t border-sand-200">
        {shown.map((s) => (
          <li key={s.key} className="flex items-start justify-between gap-4 py-[10px]">
            <span className="flex flex-col gap-[2px]">
              <span className="text-[14px] text-ink-900">{s.label}</span>
              <span className="text-[13px] text-ink-500">{s.display}</span>
            </span>
            {s.editable && s.group === "plans" ? (
              <a
                href="/onboarding/plan-rules?return=bliss"
                className="text-[14px] font-medium text-brand-violet hover:underline"
              >
                Change
              </a>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
