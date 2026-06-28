"use client";

import { BlissWordmark } from "@/components/BlissWordmark";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { devLogin, fetchMewsConnection, updateMerchant } from "@/lib/api";
import { DEMO_HOTEL } from "@/lib/mewsDemo";

// Simulated Mews OAuth consent screen. "Authorize" provisions (find-or-create)
// the Bliss demo merchant for this property and hands off into Bliss
// onboarding. No real OAuth — the .env Mews credentials are already trusted;
// this screen makes the handoff look real and verifies the live connection.

const SCOPES = [
  {
    title: "Reservations",
    detail: "View upcoming and in-house reservations",
  },
  {
    title: "Customer profiles",
    detail: "View guest names and contact details",
  },
  {
    title: "Rates & services",
    detail: "View your property and service configuration",
  },
];

export default function AuthorizePage() {
  const router = useRouter();
  const [phase, setPhase] = useState<"consent" | "authorizing" | "redirecting">(
    "consent",
  );
  const [error, setError] = useState<string | null>(null);
  const [enterprise, setEnterprise] = useState<string | null>(null);

  // Background live probe — proves the .env credentials resolve to a real Mews
  // property. Non-blocking; the consent screen renders regardless.
  useEffect(() => {
    fetchMewsConnection()
      .then((c) => {
        if (c.connected) {
          setEnterprise(c.enterpriseName ?? "Mews property");
        }
      })
      .catch(() => {
        /* connection chip just won't show */
      });
  }, []);

  async function handleAuthorize() {
    setError(null);
    setPhase("authorizing");
    try {
      await devLogin(DEMO_HOTEL.email);
      await updateMerchant({
        businessName: DEMO_HOTEL.businessName,
        businessType: DEMO_HOTEL.businessType,
        addressLine1: DEMO_HOTEL.addressLine1,
        addressCity: DEMO_HOTEL.addressCity,
        addressState: DEMO_HOTEL.addressState,
        addressZip: DEMO_HOTEL.addressZip,
      });
      setPhase("redirecting");
      // Brief beat so the "redirecting back to Bliss" state is visible.
      setTimeout(() => router.push("/onboarding/connect-stripe"), 900);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not authorize. Try again.",
      );
      setPhase("consent");
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#EAEEF4] px-6 font-body text-[#51576A]">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2">
          <span className="text-lg font-semibold tracking-tight text-neutral-800">mews</span>
          <span className="rounded bg-neutral-200/70 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-neutral-500">
            Authorize
          </span>
        </div>

        <div className="rounded-2xl border border-[#97ACC8]/30 bg-white p-7 shadow-sm">
          {/* App identity */}
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#C9AFFA] px-1 text-center leading-none">
              <BlissWordmark className="text-[11px] text-white" />
            </div>
            <div className="text-2xl text-[#97ACC8]">→</div>
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-neutral-100 text-sm font-semibold text-neutral-700">
              mews
            </div>
          </div>

          <h1 className="mt-5 text-xl font-semibold text-[#51576A]">
            Authorize Bliss Payment Plans
          </h1>
          <p className="mt-1 text-sm text-[#51576A]/75">
            Bliss is requesting access to{" "}
            <span className="font-medium text-[#51576A]">
              {DEMO_HOTEL.businessName}
            </span>{" "}
            on Mews.
          </p>

          {enterprise ? (
            <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs text-emerald-700">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Live Mews connection verified
            </div>
          ) : null}

          {/* Scopes */}
          <div className="mt-6 space-y-3">
            {SCOPES.map((s) => (
              <div key={s.title} className="flex gap-3">
                <span className="mt-0.5 text-[#6A629E]">✓</span>
                <div>
                  <div className="text-sm font-medium text-[#51576A]">{s.title}</div>
                  <div className="text-xs text-[#51576A]/65">{s.detail}</div>
                </div>
              </div>
            ))}
          </div>

          {error ? (
            <p className="mt-5 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          ) : null}

          {/* Actions */}
          <div className="mt-7 space-y-3">
            <button
              type="button"
              onClick={handleAuthorize}
              disabled={phase !== "consent"}
              className="w-full rounded-lg bg-[#C9AFFA] px-6 py-3 font-medium text-white transition-colors hover:bg-[#BBA0F4] disabled:opacity-60"
            >
              {phase === "consent"
                ? "Authorize"
                : phase === "authorizing"
                  ? "Authorizing…"
                  : "Redirecting to Bliss…"}
            </button>
            <Link
              href="/mews-marketplace"
              className="block text-center text-sm text-[#51576A]/60 hover:text-[#51576A]"
            >
              Cancel
            </Link>
          </div>
        </div>

        <p className="mt-4 text-center text-[11px] text-[#51576A]/50">
          You can revoke access anytime from Mews Marketplace.
        </p>
      </div>
    </div>
  );
}
