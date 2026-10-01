package com.bliss.b2b.domain;

import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

public record PaymentScheduleEntry(
        UUID id,
        UUID paymentPlanId,
        int sequence,
        LocalDate dueDate,
        long amountCents,
        PaymentScheduleStatus status,
        ScheduleKind kind,
        String stripePaymentIntentId,
        Instant attemptedAt,
        Instant paidAt,
        int retryCount,
        String lastError,
        Instant createdAt,
        Instant updatedAt,
        // The Mews PaymentId that charged this row, on the Mews rail.
        String mewsPaymentId
) {
    /**
     * The charge that settled this row on whichever rail: the Mews payment id
     * or the Stripe PaymentIntent id. Rows a pay off settled together share it.
     */
    public String paymentRef() {
        return mewsPaymentId != null && !mewsPaymentId.isBlank() ? mewsPaymentId : stripePaymentIntentId;
    }
}
