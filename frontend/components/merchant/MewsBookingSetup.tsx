"use client";

import { useEffect, useState } from "react";
import {
  fetchMewsSetupOptions,
  saveMewsSetup,
  type MewsRate,
  type MewsSetupOptions,
  type MewsSetupResult,
} from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Label } from "@/components/ui/Label";

// Which Mews rates are the Bliss rates, one per payment schedule. A guest who
// picks a plan in the Bliss pop-up books that schedule's rate in the Mews
// booking engine; Mews takes the card and the rate's upfront charge, and Bliss
// builds the plan for the rest from the reservation. The lists are read live
// from the property's Mews; the server checks the choice again on save.

export function MewsBookingSetup() {
  const [options, setOptions] = useState<MewsSetupOptions | null>(null);
  const [serviceId, setServiceId] = useState("");
  const [monthlyRateId, setMonthlyRateId] = useState("");
  const [biweeklyRateId, setBiweeklyRateId] = useState("");
  // Display-only deposit percentages, as typed ("20", "12.5").
  const [monthlyDeposit, setMonthlyDeposit] = useState("");
  const [biweeklyDeposit, setBiweeklyDeposit] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<MewsSetupResult | null>(null);

  async function load(forService?: string) {
    setLoading(true);
    setError(null);
    try {
      const next = await fetchMewsSetupOptions(forService);
      const known = (id: string | null) => (id && next.rates.some((r) => r.id === id) ? id : "");
      setOptions(next);
      setServiceId(next.selectedServiceId ?? "");
      setMonthlyRateId(known(next.selectedMonthlyRateId));
      setBiweeklyRateId(known(next.selectedBiweeklyRateId));
      setMonthlyDeposit(bpsToPercent(next.monthlyDepositBps));
      setBiweeklyDeposit(bpsToPercent(next.biweeklyDepositBps));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read your Mews setup.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      setSaved(
        await saveMewsSetup(
          serviceId,
          monthlyRateId || null,
          biweeklyRateId || null,
          percentToBps(monthlyDeposit),
          percentToBps(biweeklyDeposit),
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save your booking setup.");
    } finally {
      setSaving(false);
    }
  }

  const sameRate = monthlyRateId !== "" && monthlyRateId === biweeklyRateId;
  const badDeposit =
    (monthlyDeposit.trim() !== "" && percentToBps(monthlyDeposit) == null) ||
    (biweeklyDeposit.trim() !== "" && percentToBps(biweeklyDeposit) == null);
  const canSave =
    !loading && !saving && serviceId !== "" && (monthlyRateId || biweeklyRateId) && !sameRate && !badDeposit;

  return (
    <form onSubmit={handleSave} className="w-full text-left">
      <h3 className="text-lg font-medium text-ink-900">Booking setup</h3>
      <p className="mt-1.5 text-base leading-[1.5] text-ink-500">
        Choose the Mews rate guests book for each payment schedule. Give each Bliss rate a payment
        policy in Mews that charges a percentage on confirmation. That charge is the guest&apos;s
        first payment, and Bliss collects the rest.
      </p>

      <div className="mt-5 space-y-4">
        <div>
          <Label htmlFor="mewsService">Stay service</Label>
          <select
            id="mewsService"
            className="input mt-1.5"
            value={serviceId}
            disabled={loading || saving}
            onChange={(e) => {
              setServiceId(e.target.value);
              setMonthlyRateId("");
              setBiweeklyRateId("");
              setSaved(null);
              void load(e.target.value || undefined);
            }}
          >
            <option value="">Choose a service</option>
            {options?.services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <RateSelect
          id="mewsMonthlyRate"
          label="Monthly plan rate"
          value={monthlyRateId}
          rates={options?.rates ?? []}
          disabled={loading || saving || !serviceId}
          onChange={(v) => {
            setMonthlyRateId(v);
            setSaved(null);
          }}
          deposit={monthlyDeposit}
          onDepositChange={(v) => {
            setMonthlyDeposit(v);
            setSaved(null);
          }}
        />
        <RateSelect
          id="mewsBiweeklyRate"
          label="Every 2 weeks plan rate"
          value={biweeklyRateId}
          rates={options?.rates ?? []}
          disabled={loading || saving || !serviceId}
          onChange={(v) => {
            setBiweeklyRateId(v);
            setSaved(null);
          }}
          deposit={biweeklyDeposit}
          onDepositChange={(v) => {
            setBiweeklyDeposit(v);
            setSaved(null);
          }}
        />
        {badDeposit ? (
          <p className="text-base text-danger">
            Enter each deposit as a percentage from 0 to 100, with up to two decimal places.
          </p>
        ) : null}
        {sameRate ? (
          <p className="text-base text-danger">
            Each schedule needs its own rate, so Bliss can tell which plan the guest chose.
          </p>
        ) : null}
      </div>

      {error ? (
        <p className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-base text-danger">{error}</p>
      ) : null}
      {saved ? (
        <p className="mt-5 rounded-xl bg-emerald-50 px-4 py-3 text-base text-emerald-800">
          Saved.{" "}
          {[
            saved.monthlyRateName ? `Monthly plans book ${saved.monthlyRateName}.` : null,
            saved.biweeklyRateName ? `Every 2 weeks plans book ${saved.biweeklyRateName}.` : null,
          ]
            .filter(Boolean)
            .join(" ")}
        </p>
      ) : null}

      <div className="mt-6">
        <Button type="submit" variant="merchant" disabled={!canSave}>
          {saving ? "Saving" : "Save booking setup"}
        </Button>
      </div>
    </form>
  );
}

function RateSelect({
  id,
  label,
  value,
  rates,
  disabled,
  onChange,
  deposit,
  onDepositChange,
}: {
  id: string;
  label: string;
  value: string;
  rates: MewsRate[];
  disabled: boolean;
  onChange: (value: string) => void;
  deposit: string;
  onDepositChange: (value: string) => void;
}) {
  const chosen = rates.find((r) => r.id === value);
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        className="input mt-1.5"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Not offered</option>
        {rates.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
            {r.isPublic ? "" : " (private)"}
          </option>
        ))}
      </select>
      {value ? (
        <div className="mt-3">
          <Label htmlFor={`${id}Deposit`}>Upfront charge shown to guests (%)</Label>
          <input
            id={`${id}Deposit`}
            className="input mt-1.5 max-w-[160px]"
            inputMode="decimal"
            placeholder="e.g. 20"
            value={deposit}
            disabled={disabled}
            onChange={(e) => onDepositChange(e.target.value)}
          />
          <p className="mt-1.5 text-[13px] text-ink-500">
            Match the percentage this rate&apos;s payment policy charges in Mews. It is only what the
            Bliss pop-up shows; plans always use what Mews actually charged.
          </p>
        </div>
      ) : null}
      {chosen && !chosen.isPublic ? (
        <p className="mt-2 text-base text-amber-700">
          This rate is private, so your booking engine only shows it to guests with its voucher
          code. Bliss rates are usually public.
        </p>
      ) : null}
    </div>
  );
}

/**
 * "20" or "12.5" to basis points (2000, 1250), without floating point. Null for
 * an empty field or anything that is not 0 to 100 with at most two decimals.
 */
function percentToBps(input: string): number | null {
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(input.trim());
  if (!m) return null;
  const whole = Number(m[1]);
  const frac = Number((m[2] ?? "").padEnd(2, "0"));
  const bps = whole * 100 + frac;
  return bps <= 10000 ? bps : null;
}

function bpsToPercent(bps: number | null): string {
  if (bps == null) return "";
  const whole = Math.floor(bps / 100);
  const frac = bps % 100;
  if (frac === 0) return String(whole);
  return `${whole}.${String(frac).padStart(2, "0").replace(/0$/, "")}`;
}
