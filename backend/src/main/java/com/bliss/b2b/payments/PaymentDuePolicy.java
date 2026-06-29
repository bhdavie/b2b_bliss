package com.bliss.b2b.payments;

/**
 * When must all installments be cleared by, relative to the appointment date?
 * Drives {@link MerchantPlanRules#paymentDueOffsetDays(Integer)} which feeds
 * the eligibility math: the final installment plus the system 3-day retry
 * buffer must land on or before {@code appointment - offset}.
 */
public enum PaymentDuePolicy {
    AT_APPOINTMENT("at_appointment", 0),
    ONE_WEEK_BEFORE("one_week_before", 7),
    ONE_MONTH_BEFORE("one_month_before", 30),
    CUSTOM_MONTHS("custom_months", -1);

    private final String wire;
    private final int fixedOffsetDays;

    PaymentDuePolicy(String wire, int fixedOffsetDays) {
        this.wire = wire;
        this.fixedOffsetDays = fixedOffsetDays;
    }

    public String wire() {
        return wire;
    }

    /**
     * Resolves the offset days for this policy. For {@code CUSTOM_MONTHS}
     * the caller must pass the merchant-configured day count (the stored
     * value is days before check-in); for the fixed policies the parameter
     * is ignored.
     */
    public int offsetDays(Integer customMonths) {
        if (this == CUSTOM_MONTHS) {
            // The stored value is days before check-in (field name kept for wire
            // compatibility), used directly as the offset.
            return customMonths == null ? 0 : customMonths;
        }
        return fixedOffsetDays;
    }

    public static PaymentDuePolicy fromWire(String wire) {
        for (PaymentDuePolicy p : values()) {
            if (p.wire.equals(wire)) return p;
        }
        throw new IllegalArgumentException("Unknown payment due policy: " + wire);
    }
}
