"use client";

import { useState } from "react";
import { connectMews, type MewsConnectResult } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";

// Property enters its Mews Connector tokens; we validate them against Mews
// (Get configuration) before storing. On success we show the enterprise we
// resolved and let them continue.

const DEMO_PLATFORM_URL = "https://api.mews-demo.com";
// Public Mews demo credentials (Gross pricing UK demo property). Safe to ship:
// docs.mews.com states the demo environment is completely public.
const DEMO_CLIENT_TOKEN = "E0D439EE522F44368DC78E1BFB03710C-D24FB11DBE31D4621C4817E028D9E1D";
const DEMO_ACCESS_TOKEN = "C66EF7B239D24632943D115EDE9CB810-EA00F8FD8294692C940F6B5A8F9453D";

export function ConnectMewsStep({ alreadyConnected }: { alreadyConnected?: MewsConnectResult | null }) {
  const [platformUrl, setPlatformUrl] = useState("");
  const [clientToken, setClientToken] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MewsConnectResult | null>(alreadyConnected ?? null);

  function fillDemo() {
    setPlatformUrl(DEMO_PLATFORM_URL);
    setClientToken(DEMO_CLIENT_TOKEN);
    setAccessToken(DEMO_ACCESS_TOKEN);
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await connectMews({
        platformUrl: platformUrl.trim() || undefined,
        clientToken: clientToken.trim(),
        accessToken: accessToken.trim(),
      });
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not connect to Mews.");
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    return (
      <Card padding="xl" className="text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
          ✓
        </div>
        <h2 className="mt-4 text-lg font-medium text-brand-navy">Mews connected</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Linked to <span className="font-medium text-ink">{result.enterpriseName}</span>
          {result.currency ? ` · charging in ${result.currency}` : ""}.
        </p>
        <Button href="/onboarding/plan-rules" variant="merchant" className="mt-6 inline-block">
          Continue
        </Button>
      </Card>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="card p-8">
      <h2 className="text-lg font-medium text-brand-navy">Connect Mews</h2>
      <p className="mt-1 text-sm text-ink-muted">
        Enter your Mews Connector API tokens. We check them against Mews before saving.
      </p>

      <div className="mt-6 space-y-4">
        <div>
          <Label htmlFor="platformUrl">
            Platform URL
          </Label>
          <Input
            id="platformUrl"
            type="text"
            placeholder={DEMO_PLATFORM_URL}
            value={platformUrl}
            onChange={(e) => setPlatformUrl(e.target.value)}
            autoComplete="off"
          />
          <p className="mt-1 text-xs text-brand-navy/55">
            Leave blank to use the Mews demo environment.
          </p>
        </div>
        <div>
          <Label htmlFor="clientToken">
            Client token
          </Label>
          <Input
            id="clientToken"
            type="text"
            value={clientToken}
            onChange={(e) => setClientToken(e.target.value)}
            autoComplete="off"
            required
          />
        </div>
        <div>
          <Label htmlFor="accessToken">
            Access token
          </Label>
          <Input
            id="accessToken"
            type="text"
            value={accessToken}
            onChange={(e) => setAccessToken(e.target.value)}
            autoComplete="off"
            required
          />
        </div>
      </div>

      {error ? (
        <p className="mt-5 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      <Button
        type="submit"
        disabled={submitting || !clientToken.trim() || !accessToken.trim()}
        variant="merchant"
        className="mt-6 w-full disabled:opacity-60"
      >
        {submitting ? "Validating with Mews" : "Validate and connect"}
      </Button>

      <button
        type="button"
        onClick={fillDemo}
        className="mt-3 w-full text-center text-xs font-medium text-brand-purple hover:underline"
      >
        Use demo credentials
      </button>
    </form>
  );
}
