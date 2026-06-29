package com.bliss.b2b.api;

import com.bliss.b2b.domain.Booking;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;

public record BookingView(
        String id,
        String bookingToken,
        String hostedUrl,
        String serviceName,
        String serviceDescription,
        long totalAmountCents,
        Long originalTotalAmountCents,
        LocalDate appointmentDate,
        LocalDate checkoutDate,
        String cancellationPolicy,
        String status,
        String source,
        String customerNameHint,
        String customerEmailHint,
        String customerPhoneHint,
        Instant createdAt,
        String derivedStatus,
        EligibilityView eligibility,
        List<PlanOptionView> planOptions
) {
    public static BookingView summary(Booking b, String hostedUrl, String derivedStatus) {
        return new BookingView(
                b.id().toString(),
                b.bookingToken(),
                hostedUrl,
                b.serviceName(),
                b.serviceDescription(),
                b.totalAmountCents(),
                b.originalTotalAmountCents(),
                b.appointmentDate(),
                b.checkoutDate(),
                b.cancellationPolicy(),
                b.status().wire(),
                b.source().wire(),
                b.customerNameHint(),
                b.customerEmailHint(),
                b.customerPhoneHint(),
                b.createdAt(),
                derivedStatus,
                null,
                null
        );
    }

    public static BookingView detail(
            Booking b,
            String hostedUrl,
            EligibilityView eligibility,
            List<PlanOptionView> planOptions
    ) {
        return new BookingView(
                b.id().toString(),
                b.bookingToken(),
                hostedUrl,
                b.serviceName(),
                b.serviceDescription(),
                b.totalAmountCents(),
                b.originalTotalAmountCents(),
                b.appointmentDate(),
                b.checkoutDate(),
                b.cancellationPolicy(),
                b.status().wire(),
                b.source().wire(),
                b.customerNameHint(),
                b.customerEmailHint(),
                b.customerPhoneHint(),
                b.createdAt(),
                null,
                eligibility,
                planOptions
        );
    }

    public record EligibilityView(
            boolean eligible,
            String reason,
            long daysToAppointment,
            long depositAmountCents
    ) {}

    public record PlanOptionView(
            String frequency,
            int numPayments,
            long perPaymentAmountCents,
            long finalPaymentAmountCents,
            List<LocalDate> dueDates
    ) {}
}
