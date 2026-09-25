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
        Long originalTotalAmountCents,
        LocalDate appointmentDate,
        LocalDate checkoutDate,
        String cancellationPolicy,
        BookingStatus status,
        BookingSource source,
        UUID customerId,
        String customerNameHint,
        String customerEmailHint,
        String customerPhoneHint,
        Instant createdAt,
        Instant updatedAt,
        // Mews stay (V31). Null for bookings that are not Mews reservations.
        String mewsReservationId,
        String mewsResourceCategoryId,
        String mewsRateId,
        Integer adultCount
) {}
