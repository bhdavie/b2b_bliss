"use client";

import { useEffect, useState } from "react";
import {
  fetchMewsSetupOptions,
  saveMewsSetup,
  type MewsSetupOptions,
  type MewsSetupResult,
} from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Label } from "@/components/ui/Label";

// Which Mews service and rate Bliss books for this property. Bliss creates the
// reservation itself, on a rate the hotel keeps private and free of any Mews
// payment policy, so Mews never charges on top of the plan. The lists are read
// live from the property's Mews; the server checks the choice again on save.

export function MewsBookingSetup() {
  const [options, setOptions] = useState<MewsSetupOptions | null>(null);
  const [serviceId, setServiceId] = useState("");
  const [rateId, setRateId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<MewsSetupResult | null>(null);

  async function load(forService?: string) {
    setLoading(true);
    setError(null);
    try {
      const next = await fetchMewsSetupOptions(forService);
      setOptions(next);
      setServiceId(next.selectedServiceId ?? "");
      setRateId(next.rates.some((r) => r.id === next.selectedRateId) ? next.selectedRateId ?? "" : "");
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
      setSaved(await saveMewsSetup(serviceId, rateId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save your booking setup.");
    } finally {
      setSaving(false);
    }
  }

  const chosenRate = options?.rates.find((r) => r.id === rateId);

  return (
    <form onSubmit={handleSave} className="w-full text-left">
      <h3 className="text-lg font-medium text-ink-900">Booking setup</h3>
      <p className="mt-1.5 text-base leading-[1.5] text-ink-500">
        Choose the stay service and the rate Bliss books. Use a private rate with no payment policy
        in Mews, so Mews never charges on top of the plan.
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
              setRateId("");
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
        <div>
          <Label htmlFor="mewsRate">Bliss rate</Label>
          <select
            id="mewsRate"
            className="input mt-1.5"
            value={rateId}
            disabled={loading || saving || !serviceId}
            onChange={(e) => {
              setRateId(e.target.value);
              setSaved(null);
            }}
          >
            <option value="">Choose a rate</option>
            {options?.rates.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
                {r.isPublic ? " (public)" : ""}
              </option>
            ))}
          </select>
          {chosenRate?.isPublic ? (
            <p className="mt-2 text-base text-amber-700">
              This rate is public. Guests can book it in your booking engine too, and any payment
              policy on it will charge them in Mews. A private rate is recommended.
            </p>
          ) : null}
        </div>
      </div>

      {error ? (
        <p className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-base text-red-700">{error}</p>
      ) : null}
      {saved ? (
        <p className="mt-5 rounded-xl bg-emerald-50 px-4 py-3 text-base text-emerald-800">
          Saved. Bliss will book {saved.rateName}.
        </p>
      ) : null}

      <div className="mt-6">
        <Button
          type="submit"
          variant="merchant"
          disabled={loading || saving || !serviceId || !rateId}
        >
          {saving ? "Saving" : "Save booking setup"}
        </Button>
      </div>
    </form>
  );
}
