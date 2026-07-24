package com.bliss.b2b.integration.pms;

/**
 * Settlement status of a stored-card charge, mapped from the PMS payment state.
 * A {@link #FAILED} or {@link #CANCELED} charge is a payment-level decline: it
 * is returned on a {@link PmsChargeResult}, not thrown, so the caller can react
 * without catching. {@link #UNKNOWN} covers a state the PMS reports that we do
 * not model, or a payment we could not read back.
 */
public enum PmsChargeStatus {
    CHARGED,
    PENDING,
    VERIFYING,
    FAILED,
    CANCELED,
    UNKNOWN;

    /** True only when the money moved. */
    public boolean succeeded() {
        return this == CHARGED;
    }

    /** True for a payment-level decline (as opposed to still-settling states). */
    public boolean declined() {
        return this == FAILED || this == CANCELED;
    }

    /**
     * Maps a Mews payment {@code State} string to this enum. Unrecognised or
     * null states become {@link #UNKNOWN}.
     */
    public static PmsChargeStatus fromMewsState(String state) {
        if (state == null) {
            return UNKNOWN;
        }
        switch (state) {
            case "Charged":
                return CHARGED;
            case "Pending":
                return PENDING;
            case "Verifying":
                return VERIFYING;
            case "Failed":
                return FAILED;
            case "Canceled":
                return CANCELED;
            default:
                return UNKNOWN;
        }
    }
}
