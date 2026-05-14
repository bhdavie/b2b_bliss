package com.bliss.b2b.domain;

import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

public record Booking(
        UUID id,
        UUID merchantId,
        String bookingToken,
        String serviceName,
        String serviceDescription,
        long totalAmountCents,
        LocalDate appointmentDate,
        String cancellationPolicy,
        BookingStatus status,
        UUID customerId,
        String customerNameHint,
        String customerEmailHint,
        Instant createdAt,
        Instant updatedAt
) {}
