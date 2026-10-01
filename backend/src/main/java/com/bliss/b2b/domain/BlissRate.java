package com.bliss.b2b.domain;

import com.bliss.b2b.payments.BookingType;
import com.bliss.b2b.payments.CancellationTerms;
import com.bliss.b2b.payments.PlanFrequency;
import java.time.Instant;
import java.util.UUID;

/**
 * A Bliss rate as last synced from Mews (V39): its name and rate group, its
 * cancellation terms, the booking type those imply, and the hotel's override.
 * {@code syncedAt} is null until the first sync.
 */
public record BlissRate(
        UUID merchantId,
        String mewsRateId,
        PlanFrequency frequency,
        String rateName,
        String rateGroupId,
        boolean active,
        CancellationTerms terms,
        BookingType derivedType,
        BookingType override,
        Instant syncedAt) {

    /** The hotel's choice when it made one, otherwise what Mews says. */
    public BookingType bookingType() {
        return override != null ? override : derivedType;
    }
}
