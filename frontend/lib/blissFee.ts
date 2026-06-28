// Single frontend source of truth for the Bliss fee. Mirrors
// BLISS_FEE_RATE / feeFor / the schedule split in
// backend/src/main/java/com/bliss/b2b/service/PlanCreationService.java; the two
// must stay in sync. The fee is 5% of the full plan total (the customer-facing
// booking total, already inclusive of taxes and fees).

export const BLISS_FEE_RATE = 0.05;

/** 5% of the full total, rounded to whole cents. */
export function feeFor(baseCents: number): number {
  return Math.round(baseCents * BLISS_FEE_RATE);
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
}: {
  baseCents: number;
  numPayments: number;
}): {
  feeCents: number;
  totalWithFeeCents: number;
  perPaymentCents: number;
  finalPaymentCents: number;
} {
  const feeCents = feeFor(baseCents);
  const totalWithFeeCents = baseCents + feeCents;
  if (numPayments <= 0) {
    return { feeCents, totalWithFeeCents, perPaymentCents: 0, finalPaymentCents: 0 };
  }
  const perPaymentCents = Math.round(totalWithFeeCents / numPayments);
  const finalPaymentCents = totalWithFeeCents - perPaymentCents * (numPayments - 1);
  return { feeCents, totalWithFeeCents, perPaymentCents, finalPaymentCents };
}
