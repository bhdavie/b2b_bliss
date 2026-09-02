// Single frontend source of truth for the Bliss processing fee.
//
// The rate is NOT a constant. It is configured per property in
// merchant_fee_rates and resolved as of now, so the only correct way to quote
// a fee is to ask the backend what this property's rate is and then apply it.
// Every consumer therefore takes a rate rather than assuming one.
//
// Mirrors PlanCreationService.feeFor / the schedule split in
// backend/src/main/java/com/bliss/b2b/service/PlanCreationService.java.

import { API_BASE_URL } from "./api";

/**
 * Used ONLY when the rate fetch fails: a network error, a non-OK response, or
 * a body that is not a usable number. It is not a default rate and no code
 * path should reach for it as one.
 *
 * Deliberately 0.05 and deliberately not 0. The backend falls back to the same
 * 0.05 when a property has no effective rate row, so on a failed fetch the two
 * sides still agree in the common case. Falling back to 0 would be the worse
 * direction in every case: the guest would be shown no fee and then charged
 * one, which is the exact mismatch this module exists to prevent.
 */
export const FALLBACK_FEE_RATE = 0.05;

/** The scale of merchant_fee_rates.rate, numeric(6,5). Five decimal places. */
const RATE_SCALE = 100_000;

/**
 * The fee in whole cents for a base total at a given rate.
 *
 * Matches the backend exactly. PlanCreationService.feeFor does
 * BigDecimal.valueOf(totalCents).multiply(rate).setScale(0, HALF_UP), which is
 * exact decimal arithmetic. `Math.round(baseCents * rate)` is NOT equivalent:
 * it is half-up on paper, but binary floating point can land a true .5 case a
 * hair below and round it down, drifting a cent from what the backend charges.
 *
 * So this stays in integers. The rate has at most five decimal places, so
 * scaling it to an integer makes `baseCents * scaledRate` an exact product,
 * and half-up on a positive integer division is floor((n + half) / divisor).
 */
export function feeForAtRate(baseCents: number, rate: number): number {
  if (!Number.isFinite(baseCents) || baseCents <= 0) return 0;
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  const scaledRate = Math.round(rate * RATE_SCALE);
  if (scaledRate <= 0) return 0;
  const scaledFee = baseCents * scaledRate;
  return Math.floor((scaledFee + RATE_SCALE / 2) / RATE_SCALE);
}

/**
 * The property's fee rate as of now, as a decimal fraction (0.05 = 5%).
 *
 * Never throws and never returns null: a quote has to render, so any failure
 * resolves to FALLBACK_FEE_RATE. A 404 is treated the same way, since a slug
 * that does not resolve is a caller problem rather than a reason to show a
 * guest a fee of zero.
 */
export async function fetchFeeRate(slug: string): Promise<number> {
  try {
    const res = await fetch(
      `${API_BASE_URL}/api/v1/public/merchants/${encodeURIComponent(slug)}/fee-rate`,
      { cache: "no-store" },
    );
    if (!res.ok) return FALLBACK_FEE_RATE;
    const body = (await res.json()) as { rate?: unknown };
    // The backend serialises a BigDecimal, which arrives as a JSON number.
    // Number() also copes with it arriving as a string.
    const rate = Number(body?.rate);
    if (!Number.isFinite(rate) || rate < 0) return FALLBACK_FEE_RATE;
    return rate;
  } catch {
    return FALLBACK_FEE_RATE;
  }
}

/**
 * Even-split installment plan over the fee-inclusive total. Matches the
 * backend no-deposit schedule build: every installment is round(totalWithFee /
 * numPayments) and the final one absorbs the rounding remainder, so the
 * installments sum exactly to totalWithFee.
 */
export function calcInstallmentPlan({
  baseCents,
  numPayments,
  feeRate,
}: {
  baseCents: number;
  numPayments: number;
  feeRate: number;
}): {
  feeCents: number;
  totalWithFeeCents: number;
  perPaymentCents: number;
  finalPaymentCents: number;
} {
  const feeCents = feeForAtRate(baseCents, feeRate);
  const totalWithFeeCents = baseCents + feeCents;
  if (numPayments <= 0) {
    return { feeCents, totalWithFeeCents, perPaymentCents: 0, finalPaymentCents: 0 };
  }
  const perPaymentCents = Math.round(totalWithFeeCents / numPayments);
  const finalPaymentCents = totalWithFeeCents - perPaymentCents * (numPayments - 1);
  return { feeCents, totalWithFeeCents, perPaymentCents, finalPaymentCents };
}
