package com.bliss.b2b.domain;

import com.bliss.b2b.payments.PlanFrequency;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

public record PaymentPlan(
        UUID id,
        UUID bookingId,
        UUID customerId,
        UUID customerCardId,
        long totalAmountCents,
        int numPayments,
        PlanFrequency frequency,
        LocalDate startDate,
        LocalDate endDate,
        PaymentPlanStatus status,
        long depositAmountCents,
        Instant canceledAt,
        String canceledReason,
        Instant createdAt,
        Instant updatedAt
) {}
