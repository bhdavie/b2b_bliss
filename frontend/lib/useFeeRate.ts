"use client";

import { useEffect, useState } from "react";
import { FALLBACK_FEE_RATE, fetchFeeRate } from "./blissFee";

/**
 * One in-flight request per slug, shared by every caller in the page.
 *
 * The demo inn pages call this hook from more than one component (the page
 * itself, and the teaser that renders once per rate card), and without this
 * each mount would fire its own request for the same number. Keyed by slug and
 * held for the life of the page load, which is the same window over which the
 * quote itself is valid.
 */
const inFlight = new Map<string, Promise<number>>();

function feeRateOnce(slug: string): Promise<number> {
  const existing = inFlight.get(slug);
  if (existing) return existing;
  const promise = fetchFeeRate(slug);
  inFlight.set(slug, promise);
  return promise;
}

/**
 * The property's processing-fee rate, for client components that have a slug
 * but no server render to fetch it in. The demo inn pages are the callers:
 * they are "use client" end to end and already read the property this way.
 *
 * Returns FALLBACK_FEE_RATE until the fetch resolves, so the first paint quotes
 * the same number the backend falls back to rather than flashing a zero fee.
 * On any failure fetchFeeRate resolves to that same fallback, so this never
 * rejects and never leaves the caller without a rate.
 */
export function useFeeRate(slug: string): number {
  const [feeRate, setFeeRate] = useState<number>(FALLBACK_FEE_RATE);

  useEffect(() => {
    let cancelled = false;
    feeRateOnce(slug).then((rate) => {
      if (!cancelled) setFeeRate(rate);
    });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  return feeRate;
}
