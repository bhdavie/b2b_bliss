"use client";

import { useState } from "react";
import { connectMews, type MewsConnectResult } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { Panel } from "@/components/ui/primitives";

// Property enters its Mews Connector tokens; we validate them against Mews
// (Get configuration) before storing. On success we show the enterprise we
// resolved and let them continue.
//
// Chrome is plan-rules': a Panel with the settled title, `.label` fields and a
// ruled action row at the foot. The two actions are the Save/Cancel pairing
// account settings uses, violet pill beside ghost pill, rather than a full-width
// button over a text link.

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
      <Panel className="mx-auto w-full max-w-[560px] items-center gap-5 px-10 pb-10 pt-9 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-violet text-xl text-white">
          ✓
        </div>
        <h2 className="text-[28px] font-medium tracking-[-0.02em] text-ink-900">
          Mews connected
        </h2>
        <p className="max-w-[560px] text-lg leading-[1.6] text-ink-500">
          Linked to <span className="font-medium text-ink-900">{result.enterpriseName}</span>
          {result.currency ? ` · charging in ${result.currency}` : ""}.
        </p>
        <Button href="/onboarding/plan-rules" variant="merchant" className="mt-2">
          Continue
        </Button>
      </Panel>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col rounded-panel border border-sand-200 px-8 pb-8 pt-[30px]">
      <h2 className="text-2xl font-medium tracking-[-0.02em] text-ink-900">Connect Mews</h2>
      <p className="mt-2.5 max-w-[760px] text-[17px] leading-[1.55] text-ink-500">
        Enter your Mews Connector API tokens. We check them against Mews before saving.
      </p>

      <div className="mt-7 space-y-5">
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
            className="mt-1.5"
          />
          <p className="mt-2 text-base text-ink-400">
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
            className="mt-1.5"
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
            className="mt-1.5"
          />
        </div>
      </div>

      {error ? (
        <p className="mt-6 rounded-xl bg-red-50 px-4 py-3 text-base text-red-700">{error}</p>
      ) : null}

      <div className="mt-8 flex flex-wrap items-center gap-4 border-t border-sand-100 pt-6">
        <Button
          type="submit"
          disabled={submitting || !clientToken.trim() || !accessToken.trim()}
          variant="merchant"
          className="disabled:opacity-60"
        >
          {submitting ? "Validating with Mews" : "Validate and connect"}
        </Button>

        <Button type="button" onClick={fillDemo} variant="ghost">
          Use demo credentials
        </Button>
      </div>
    </form>
  );
}
