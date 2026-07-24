package com.bliss.b2b.integration.pms;

/**
 * Outcome of a stored-card charge, returned by
 * {@link PmsAdapter#chargeStoredCard}. {@code paymentId} is the PMS-native
 * payment identifier. {@code status} is the mapped settlement state and
 * {@code rawState} preserves the exact string the PMS returned (useful for
 * states we fold into {@link PmsChargeStatus#UNKNOWN}). Amount is echoed back in
 * the same integer minor units that were charged.
 */
public record PmsChargeResult(
        String paymentId,
        PmsChargeStatus status,
        String rawState,
        long amountMinorUnits,
        String currency) {
}
