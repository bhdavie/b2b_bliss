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
        Instant updatedAt
) {}
