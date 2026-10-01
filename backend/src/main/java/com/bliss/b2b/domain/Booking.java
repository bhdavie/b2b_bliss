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
        Integer adultCount,
        // The property's currency, zone and locale when the booking was made
        // (V36). Every amount on the booking and its plans is minor units of
        // this currency. Null currency only on a pre-V36 Mews booking whose
        // property never had one.
        String currency,
        String timeZone,
        String localeTag
) {
    /** The booking's currency, zone and locale. Throws when it has no currency. */
    public com.bliss.b2b.payments.PropertyLocale propertyLocale() {
        return new com.bliss.b2b.payments.PropertyLocale(currency, timeZone, localeTag);
    }
}
